"use server";
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
/**
 * ✅ Multi-tenant + Plans migration
 * - Ubicación: dentro de (tenant)/[tenantId]/...
 * - Wrappers (en la page): <Protected><AdminOnly><ToolGate feature="roles">…</ToolGate></AdminOnly></Protected>
 * - Contexto tenant: estas actions EXIGEN tenantId explícito.
 * - Feature gating por plan: lee tenants/{tenantId}/system_flags/plan y valida que 'roles' esté permitido.
 * - Firebase Auth (Admin): claims NAMESPACED por tenant => customClaims.tenants[tenantId].{ admin,kitchen,waiter,delivery,cashier }
 * - Matriz mínima local para validar (sin helpers externos).
 */

import { adminAuth } from "@/lib/firebase/admin"; // Admin SDK (auth)
import { getAdminDB } from "@/lib/firebase/admin"; // Firestore Admin (db)

/** ===== Tipos ===== */
type RoleKey = "admin" | "kitchen" | "waiter" | "delivery" | "cashier";
type PlanKey = "Starter" | "Pro" | "Full";

/** ===== Matriz mínima de features por plan (server-side) ===== */
const FEATURE_MATRIX: Record<PlanKey, Record<string, boolean>> = {
  Starter: { roles: true },
  Pro: { roles: true },
  Full: { roles: true },
};

/** ===== Utils de claims namespaced por tenant ===== */
type TenantedClaims = {
  tenants?: Record<string, Partial<Record<RoleKey, boolean>> | { roles?: Partial<Record<RoleKey, boolean>> }>;
  // Opcionales globales legacy:
  admin?: boolean;
  role?: string; // 'admin' / 'superadmin'
};

function hasTenantAdminClaim(decoded: TenantedClaims, tenantId: string): boolean {
  const node = decoded?.tenants?.[tenantId] as any;
  const flags = node?.roles ? { ...node.roles } : node || {};
  return !!(decoded?.admin || decoded?.role === "superadmin" || flags?.admin === true);
}

/** Aplana un nodo de tenant: {roles:{admin:true}} -> {admin:true} */
function normalizeTenantNode(node: any): Partial<Record<RoleKey, boolean>> {
  if (!node) return {};
  if (node.roles && typeof node.roles === "object") {
    return { ...(node.roles as any) };
  }
  return { ...(node as any) };
}

/** Lee el plan del tenant y valida feature */
async function requireFeatureRoles(tenantId: string) {
  const db = getAdminDB();
  const docPath = `tenants/${tenantId}/system_flags/plan`;
  const snap = await db.doc(docPath).get();
  const data = (snap.exists ? (snap.data() as { plan?: PlanKey }) : {}) || {};
  const plan = (data?.plan || "Starter") as PlanKey;
  const allowed = !!FEATURE_MATRIX[plan]?.roles;

  console.log("[roles:actions] requireFeatureRoles", { tenantId, docPath, plan, allowed });

  if (!allowed) {
    const err = new Error("feature_not_allowed");
    (err as any).status = 403;
    throw err;
  }
  return { plan };
}

/** Verifica token, rol admin por tenant y feature 'roles' */
async function assertTenantAdmin(idToken: string, tenantId: string) {
  if (!idToken) throw new Error("Missing idToken");
  if (!tenantId) throw new Error("Missing tenantId");

  // 1) Validar plan/feature
  const { plan } = await requireFeatureRoles(tenantId);

  // 2) Validar claims
  const decodedAny = (await adminAuth.verifyIdToken(idToken)) as any;
  const decoded = decodedAny as TenantedClaims;
  const uid = decodedAny?.uid;

  const ok = hasTenantAdminClaim(decoded, tenantId);

  console.log("[roles:actions] assertTenantAdmin", {
    tenantId,
    actorUid: uid,
    plan,
    ok,
    actorHasGlobalAdmin: !!decoded?.admin,
    actorRole: decoded?.role,
    actorTenantRaw: decoded?.tenants?.[tenantId] || null,
    actorTenantFlags: normalizeTenantNode(decoded?.tenants?.[tenantId]) || null,
  });

  if (!ok) {
    const err = new Error("Forbidden");
    (err as any).status = 403;
    throw err;
  }
  return decoded;
}

/** Normaliza el objeto tenants del usuario al setear claims */
function mergeTenantRoleClaims(
  current: TenantedClaims | undefined,
  tenantId: string,
  changes: Partial<Record<RoleKey, boolean>>
): TenantedClaims {
  const base: TenantedClaims = current ? { ...current } : {};
  const tenantsAny = { ...(base.tenants || {}) } as Record<string, any>;

  // Traer el previo (soporta forma antigua con {roles:{...}})
  const prevRaw = tenantsAny[tenantId];
  const prevFlags = normalizeTenantNode(prevRaw);

  // Mezclar cambios
  const nextFlags: Partial<Record<RoleKey, boolean>> = { ...prevFlags, ...changes };

  // Limpiar falsos/undefined
  (Object.keys(nextFlags) as RoleKey[]).forEach((k) => {
    if (nextFlags[k] !== true) delete nextFlags[k];
  });

  if (Object.keys(nextFlags).length === 0) {
    delete tenantsAny[tenantId]; // sin roles → borra el nodo del tenant
  } else {
    // Guardar SIEMPRE en forma PLANA (migración implícita a la forma nueva)
    tenantsAny[tenantId] = nextFlags;
  }

  return { ...base, tenants: tenantsAny as any };
}

/* ======================================================================== *
 *  ACTIONS
 * ======================================================================== */

/**
 * Lista usuarios de Firebase Auth (paginado) y FILTRA a los que tengan
 * algún claim bajo el tenantId (o superadmin/global admin).
 */
export async function listUsersAction(args: {
  idToken: string;
  tenantId: string;
  search?: string;
  nextPageToken?: string | null;
  pageSize?: number;
}) {
  const { idToken, tenantId, search = "", nextPageToken = undefined, pageSize = 50 } = args || ({} as any);

  await assertTenantAdmin(idToken, tenantId);

  const res = await adminAuth.listUsers(pageSize, nextPageToken || undefined);

  let users = res.users.map((u) => {
    const claims = (u.customClaims as TenantedClaims) || {};
    // Log opcional ligero: no imprimir claims completos en producción por privacidad.
    return {
      uid: u.uid,
      email: u.email || "",
      displayName: u.displayName || "",
      disabled: !!u.disabled,
      claims,
    };
  });

  // Filtrar por tenant (o superadmin/global admin)
  const beforeCount = users.length;
  users = users.filter((u) => {
    const c = u.claims || {};
    const has =
      hasTenantAdminClaim(c, tenantId) || // admins del tenant cuentan como visibles
      !!normalizeTenantNode((c as any)?.tenants?.[tenantId]) && // cualquier rol bajo el tenant
      Object.keys(normalizeTenantNode((c as any)?.tenants?.[tenantId])).length > 0 ||
      (c as any)?.role === "superadmin"; // superadmin
    return !!has;
  });
  const afterCount = users.length;

  // Búsqueda simple
  const q = search.trim().toLowerCase();
  if (q) {
    users = users.filter(
      (u) =>
        u.uid.toLowerCase().includes(q) ||
        u.email.toLowerCase().includes(q) ||
        u.displayName.toLowerCase().includes(q)
    );
  }

  console.log("[roles:actions] listUsersAction", {
    tenantId,
    pageSize,
    beforeCount,
    afterCount,
    search: q || null,
    returnedCount: users.length,
    nextPageToken: res.pageToken || null,
  });

  return { users, nextPageToken: res.pageToken || null };
}

/**
 * Setea claims NAMESPACED por tenant.
 * - No toca otros tenants.
 * - Limpia flags false/undefined.
 * - Si se remueven todos los roles del tenant, borra el nodo tenants[tenantId].
 * - Si el nodo estaba en forma antigua ({roles:{...}}), lo migra a la forma plana.
 */
export async function setClaimsAction(args: {
  idToken: string;
  tenantId: string;
  uid: string;
  changes: Partial<Record<RoleKey, boolean>>;
}) {
  const { idToken, tenantId, uid, changes } = args || ({} as any);

  await assertTenantAdmin(idToken, tenantId);

  if (!uid) throw new Error("Missing uid");
  if (!changes || typeof changes !== "object") throw new Error("Missing changes");

  // ⚠️ Evitar que un admin se quite su propio 'admin' y se bloquee (opcional)
  try {
    const actor = await adminAuth.verifyIdToken(idToken);
    if (actor.uid === uid && (changes as any).admin === false) {
      throw new Error("You cannot remove your own admin role for this tenant.");
    }
  } catch (e) {
    if ((e as any)?.message) throw e;
  }

  const userRec = await adminAuth.getUser(uid);
  const current = (userRec.customClaims as TenantedClaims) || {};

  // Mezcla con normalización (aplana si venía en forma {roles:{...}})
  const next = mergeTenantRoleClaims(current, tenantId, changes);

  console.log("[roles:actions] setClaimsAction", {
    tenantId,
    targetUid: uid,
    changes,
    beforeTenantRaw: (current as any)?.tenants?.[tenantId] || null,
    beforeTenantFlags: normalizeTenantNode((current as any)?.tenants?.[tenantId]) || null,
    afterTenantFlags: normalizeTenantNode((next as any)?.tenants?.[tenantId]) || null,
  });

  await adminAuth.setCustomUserClaims(uid, next);

  return { ok: true, uid, claims: next };
}
