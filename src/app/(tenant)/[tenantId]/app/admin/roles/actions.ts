"use server";

/**
 * Server Actions tenant-aware para Roles.
 * - No definimos runtime aquí (lo hace el layout del segmento).
 */

import { adminAuth, admin } from "@/lib/firebase/admin";
import { getAdminDB } from "@/lib/firebase/admin";

/* ===================== Tipos ===================== */

export type RoleKey = "admin" | "kitchen" | "waiter" | "delivery" | "cashier";
type PlanKey = "Starter" | "Pro" | "Full";

type TenantedClaims = {
  tenants?: Record<
    string,
    | Partial<Record<RoleKey, boolean>>
    | { roles?: Partial<Record<RoleKey, boolean>> }
    | { flags?: Partial<Record<RoleKey, boolean>> }
    | { rolesNormalized?: Partial<Record<RoleKey, boolean>> }
  >;
  // globales legacy
  admin?: boolean;
  role?: string; // 'admin' | 'superadmin'
  uid?: string;  // a veces lo incluimos al propagar
  [k: string]: any;
};

/* ===================== Helpers comunes ===================== */

/** Extrae un objeto "claims" flexible de cualquier forma (decoded, req.user, etc.) */
function extractClaims(u: any) {
  return u?.claims ?? u?.token ?? u ?? {};
}

/** Normaliza un nodo de tenant (acepta plano, roles, flags, rolesNormalized) */
function normalizeTenantNode(node: any): Record<string, boolean> {
  if (!node || typeof node !== "object") return {};
  const out: Record<string, boolean> = {};
  const merge = (src: any) => {
    if (!src || typeof src !== "object") return;
    for (const k of Object.keys(src)) {
      if (typeof (src as any)[k] === "boolean") out[k] ||= !!(src as any)[k];
    }
  };
  merge(node);                    // { admin:true }
  merge((node as any).roles);     // { roles:{admin:true} }
  merge((node as any).flags);     // { flags:{admin:true} }
  merge((node as any).rolesNormalized); // { rolesNormalized:{admin:true} }
  return out;
}

/** ¿Tiene rol global (legacy)? acepta admin/superadmin y arrays */
function hasRoleGlobal(claims: any, role: string) {
  return !!(
    claims?.[role] === true ||
    (Array.isArray(claims?.roles) && claims.roles.includes(role)) ||
    claims?.role === role ||
    (role === "admin" && claims?.role === "superadmin")
  );
}

/** ¿Tiene alguno de estos roles en el tenant? */
function hasAnyTenantRole(claims: any, tenantId: string, roles: RoleKey[]) {
  const flags = normalizeTenantNode(claims?.tenants?.[tenantId]);
  return roles.some((r) => !!flags[r]);
}

/** Matriz mínima de features por plan (solo roles visible aquí) */
const FEATURE_MATRIX: Record<PlanKey, Record<string, boolean>> = {
  Starter: { roles: true },
  Pro:     { roles: true },
  Full:    { roles: true },
};

/** Lee plan y valida que la feature 'roles' esté permitida */
async function requireFeatureRoles(tenantId: string) {
  const db = getAdminDB();
  const ref = db.doc(`tenants/${tenantId}/system_flags/plan`);
  const snap = await ref.get();
  const data = (snap.exists ? (snap.data() as { plan?: PlanKey }) : {}) || {};
  const plan = (data?.plan || "Starter") as PlanKey;
  const allowed = !!FEATURE_MATRIX[plan]?.roles;
  if (!allowed) {
    const err = new Error("feature_not_allowed");
    (err as any).status = 403;
    throw err;
  }
  return { plan };
}

/** Guard principal: valida token + plan + rol admin del tenant */
async function assertTenantAdmin(idToken: string, tenantId: string) {
  if (!idToken) throw new Error("Missing idToken");
  if (!tenantId) throw new Error("Missing tenantId");

  // 1) plan/feature
  await requireFeatureRoles(tenantId);

  // 2) token fresco
  const decodedAny: any = await adminAuth.verifyIdToken(idToken, true);
  const decoded = extractClaims(decodedAny) as TenantedClaims;
  decoded.uid = decodedAny?.uid;

  // 3) si no aparece el nodo del tenant, intenta leer customClaims del usuario
  let claims = decoded;
  if (!claims?.tenants || !claims.tenants[tenantId]) {
    if (decoded?.uid) {
      const rec = await adminAuth.getUser(decoded.uid);
      const cc = (rec.customClaims as TenantedClaims) || {};
      claims = { ...claims, ...cc };
    }
  }

  // 4) autorización: admin global o admin en tenant
  const allowed =
    hasRoleGlobal(claims, "admin") ||
    hasAnyTenantRole(claims, tenantId, ["admin"]);

  if (!allowed) {
    const err = new Error("Forbidden");
    (err as any).status = 403;
    throw err;
  }

  return claims;
}

/** Mezcla cambios sobre tenants[tenantId] y devuelve claims nuevos */
function mergeTenantRoleClaims(
  current: TenantedClaims | undefined,
  tenantId: string,
  changes: Partial<Record<RoleKey, boolean>>
): TenantedClaims {
  const base: TenantedClaims = current ? { ...current } : {};
  const tenants: Record<string, any> = { ...(base.tenants || {}) };

  // leer forma previa (plano o anidada)
  const prevRaw = tenants[tenantId];
  const prevFlags = normalizeTenantNode(prevRaw);

  // aplicar cambios
  const nextFlags: Record<string, boolean> = { ...prevFlags, ...changes };

  // limpiar falsos
  (Object.keys(nextFlags) as RoleKey[]).forEach((k) => {
    if (nextFlags[k] !== true) delete nextFlags[k];
  });

  if (Object.keys(nextFlags).length === 0) {
    delete tenants[tenantId];
  } else {
    // guardar SIEMPRE plano
    tenants[tenantId] = nextFlags;
  }

  return { ...base, tenants };
}

/* ===================== Actions ===================== */

/**
 * Lista usuarios visibles para el tenant: superadmin, admin global
 * o cualquier usuario que tenga algún rol bajo ese tenant.
 */
export async function listUsersAction(args: {
  idToken: string;
  tenantId: string;
  search?: string;
  nextPageToken?: string | null;
  pageSize?: number;
}) {
  const { idToken, tenantId, search = "", nextPageToken = undefined, pageSize = 50 } =
    args || ({} as any);

  try {
    await assertTenantAdmin(idToken, tenantId);

    const res = await adminAuth.listUsers(pageSize, nextPageToken || undefined);

    let users = res.users.map((u) => ({
      uid: u.uid,
      email: u.email || "",
      displayName: u.displayName || "",
      disabled: !!u.disabled,
      claims: (u.customClaims as TenantedClaims) || {},
    }));

    // ✅ Solo mostrar:
    //   - superadmin
    //   - admin global
    //   - o quien tenga AL MENOS UN rol bajo el tenant actual
    users = users.filter((u) => {
      const c = u.claims || {};
      const tenantFlags = normalizeTenantNode(c?.tenants?.[tenantId]);
      const hasTenantAny = Object.keys(tenantFlags).length > 0; // 👈 ¡la clave!
      const isSuper = c?.role === "superadmin";
      const isGlobalAdmin = hasRoleGlobal(c, "admin") || c?.admin === true;
      return isSuper || isGlobalAdmin || hasTenantAny;
    });

    const q = search.trim().toLowerCase();
    if (q) {
      users = users.filter(
        (u) =>
          u.uid.toLowerCase().includes(q) ||
          u.email.toLowerCase().includes(q) ||
          u.displayName.toLowerCase().includes(q)
      );
    }

    return { users, nextPageToken: res.pageToken || null };
  } catch (e: any) {
    console.error("[roles:listUsersAction] error", {
      tenantId,
      msg: e?.message,
      code: e?.code,
    });
    throw new Error(`roles_list_failed: ${e?.message || "unknown"}`);
  }
}


/**
 * Setea claims por-tenant (plano), limpiando falsos y preservando otros tenants.
 */
export async function setClaimsAction(args: {
  idToken: string;
  tenantId: string;
  uid: string;
  changes: Partial<Record<RoleKey, boolean>>;
}) {
  const { idToken, tenantId, uid, changes } = args || ({} as any);

  try {
    await assertTenantAdmin(idToken, tenantId);

    if (!uid) throw new Error("Missing uid");
    if (!changes || typeof changes !== "object") throw new Error("Missing changes");

    // evitar que el actor se quite su propio admin
    try {
      const actor = await adminAuth.verifyIdToken(idToken);
      if (actor?.uid === uid && (changes as any).admin === false) {
        throw new Error("You cannot remove your own admin role for this tenant.");
      }
    } catch (e) {
      if ((e as any)?.message) throw e;
    }

    const userRec = await adminAuth.getUser(uid);
    const current = (userRec.customClaims as TenantedClaims) || {};
    const next = mergeTenantRoleClaims(current, tenantId, changes);

    await adminAuth.setCustomUserClaims(uid, next);

    // lee de vuelta lo que quedó persistido
    const fresh = await adminAuth.getUser(uid);
    const savedTenantFlags = normalizeTenantNode(
      (fresh.customClaims as TenantedClaims)?.tenants?.[tenantId]
    );

    return { ok: true, uid, claims: fresh.customClaims || {}, savedTenantFlags };
  } catch (e: any) {
    console.error("[roles:setClaimsAction] error", {
      tenantId,
      targetUid: args?.uid,
      msg: e?.message,
      code: e?.code,
    });
    throw new Error(`roles_set_failed: ${e?.message || "unknown"}`);
  }
}
