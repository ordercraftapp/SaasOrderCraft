"use server";


/**
 * ✅ Multi-tenant + Plans migration
 * - Ubicación: dentro de (tenant)/[tenantId]/...
 * - Wrappers (en la page): <Protected><AdminOnly><ToolGate feature="roles">…</ToolGate></AdminOnly></Protected>
 * - Contexto tenant: estas actions EXIGEN tenantId explícito.
 * - Feature gating por plan: lee tenants/{tenantId}/system_flags/plan y valida que 'roles' esté permitido.
 * - Firebase Auth (Admin): claims NAMESPACED por tenant => customClaims.tenants[tenantId].{ admin,kitchen,waiter,delivery }
 * - Sin helpers externos de planes en server actions: matriz mínima local para validar.
 */

import { adminAuth } from "@/lib/firebase/admin"; // Admin SDK (auth)
import { getAdminDB } from "@/lib/firebase/admin"; // Firestore Admin (db)

/** ===== Tipos ===== */
export type RoleKey = "admin" | "kitchen" | "waiter" | "delivery";
type PlanKey = "Starter" | "Pro" | "Full";

/** ===== Matriz mínima de features por plan (server-side) ===== */
const FEATURE_MATRIX: Record<PlanKey, Record<string, boolean>> = {
  Starter: { roles: true },
  Pro: { roles: true },
  Full: { roles: true },
};

/** ===== Utils de claims namespaced por tenant ===== */
type TenantedClaims = {
  tenants?: Record<string, Partial<Record<RoleKey, boolean>>>;
  // Opcionales globales legacy:
  admin?: boolean;
  role?: string; // 'admin' / 'superadmin'
};

function hasTenantAdminClaim(decoded: TenantedClaims, tenantId: string): boolean {
  const t = decoded?.tenants?.[tenantId];
  return !!(decoded?.admin || decoded?.role === "superadmin" || t?.admin === true);
}

/** Lee el plan del tenant y valida feature */
async function requireFeatureRoles(tenantId: string) {
  const db = getAdminDB();
  const snap = await db.doc(`tenants/${tenantId}/system_flags/plan`).get();
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

/** Verifica token, rol admin por tenant y feature 'roles' */
async function assertTenantAdmin(idToken: string, tenantId: string) {
  if (!idToken) throw new Error("Missing idToken");
  if (!tenantId) throw new Error("Missing tenantId");

  // 1) Validar plan/feature
  await requireFeatureRoles(tenantId);

  // 2) Validar claims
  const decoded = (await adminAuth.verifyIdToken(idToken)) as unknown as TenantedClaims;
  const ok = hasTenantAdminClaim(decoded, tenantId);
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
  const tenants = { ...(base.tenants || {}) };
  const prevTenant = { ...(tenants[tenantId] || {}) };

  // Aplicar cambios (true/false). Si queda falso/undefined lo removemos.
  const nextTenant: Partial<Record<RoleKey, boolean>> = { ...prevTenant, ...changes };

  // Limpieza de flags falsos/undefined
  (Object.keys(nextTenant) as RoleKey[]).forEach((k) => {
    if (nextTenant[k] !== true) delete nextTenant[k];
  });

  if (Object.keys(nextTenant).length === 0) {
    delete tenants[tenantId]; // sin roles → borra el nodo del tenant
  } else {
    tenants[tenantId] = nextTenant;
  }

  return { ...base, tenants };
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

  let users = res.users.map((u) => ({
    uid: u.uid,
    email: u.email || "",
    displayName: u.displayName || "",
    disabled: !!u.disabled,
    claims: (u.customClaims as TenantedClaims) || {},
  }));

  // Filtrar por tenant (o superadmin/global admin)
  users = users.filter((u) => {
    const c = u.claims || {};
    const has =
      hasTenantAdminClaim(c, tenantId) || // admins del tenant cuentan como visibles
      !!c?.tenants?.[tenantId] || // cualquier rol bajo el tenant
      c?.role === "superadmin"; // superadmin
    return has;
  });

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

  return { users, nextPageToken: res.pageToken || null };
}

/**
 * Setea claims NAMESPACED por tenant.
 * - No toca otros tenants.
 * - Limpia flags false/undefined.
 * - Si se remueven todos los roles del tenant, borra el nodo tenants[tenantId].
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

  // ⚠️ Opcional: evitar que el actor se quite su propio admin
  try {
    const actor = await adminAuth.verifyIdToken(idToken);
    if (actor.uid === uid && changes.admin === false) {
      throw new Error("You cannot remove your own admin role for this tenant.");
    }
  } catch (e) {
    if ((e as any)?.message) throw e;
  }

  const userRec = await adminAuth.getUser(uid);
  const current = (userRec.customClaims as TenantedClaims) || {};
  const next = mergeTenantRoleClaims(current, tenantId, changes);

  await adminAuth.setCustomUserClaims(uid, next);

  // 🔁 Leer de vuelta lo que quedó en el backend (para UI optimista fiable)
  const fresh = await adminAuth.getUser(uid);
  const savedTenantFlags =
    ((fresh.customClaims as TenantedClaims)?.tenants?.[tenantId] as Partial<
      Record<RoleKey, boolean>
    >) || {};

  return { ok: true, uid, claims: fresh.customClaims || {}, savedTenantFlags };
}
