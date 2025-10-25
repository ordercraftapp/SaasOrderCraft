// src/lib/security/authz.ts
import { NextRequest } from "next/server";
import { getAdminAuth } from "@/lib/firebase/admin";

export type ServerUser = {
  uid: string;
  email?: string;
  roles: string[]; // ✅ globales (retro-compatible)
  // ✅ opcional: mapa por tenant (normalizado si el token lo trae)
  tenants?: Record<string, { roles: string[] }>;
};

// ---------- helpers locales ----------
function tenantFromPath(req: NextRequest): string | undefined {
  try {
    const p = req.nextUrl?.pathname || "";
    const segs = p.split("/").filter(Boolean);
    return segs[0]; // patrón "/:tenantId/..."
  } catch {
    return undefined;
  }
}

function normalizeArrayish(input: any): string[] {
  if (!input) return [];
  if (Array.isArray(input)) return input.map(String);
  if (typeof input === "string") return [input];
  if (typeof input === "object") {
    // soporta shape { admin:true, kitchen:true }
    return Object.keys(input).filter((k) => !!input[k]);
  }
  return [];
}

function uniq<T>(arr: T[]): T[] {
  return Array.from(new Set(arr));
}

// ---------- API público ----------
export async function getUserFromRequest(req: NextRequest): Promise<ServerUser | null> {
  try {
    // 1) Token por header o cookie __session
    const authz = req.headers.get("authorization") || "";
    let idToken = "";
    if (authz.toLowerCase().startsWith("bearer ")) {
      idToken = authz.slice(7).trim();
    } else {
      const cookie = req.headers.get("cookie") || "";
      const m = cookie.match(/(?:^|;)\s*__session=([^;]+)/);
      if (m) idToken = decodeURIComponent(m[1]);
    }
    if (!idToken) return null;

    // 2) Verificar token (sin revoked para rendimiento; sube si necesitas)
    const auth = getAdminAuth();
    const decoded: any = await auth.verifyIdToken(idToken, /*checkRevoked=*/ false);

    // 3) Normalizar roles globales (retro-compatible)
    const claimRole = decoded.role;     // string
    const claimRoles = decoded.roles;   // array | object
    const globalRoles = uniq([
      ...normalizeArrayish(claimRole),
      ...normalizeArrayish(claimRoles),
    ]);

    // 4) Normalizar roles por-tenant si existen en claims
    //    Soporta:
    //      - decoded.tenants[tid].roles = ['admin', ...]
    //      - decoded.rolesAtTenant[tid] = ['admin', ...] | {admin:true}
    //      - decoded.tenantId (simple)
    const tenantsMap: Record<string, { roles: string[] }> = {};

    const byTenants = decoded.tenants || {};
    for (const tid of Object.keys(byTenants)) {
      const roles = normalizeArrayish(byTenants[tid]?.roles);
      if (roles.length) tenantsMap[tid] = { roles: uniq(roles) };
    }

    const byRolesAtTenant = decoded.rolesAtTenant || {};
    for (const tid of Object.keys(byRolesAtTenant)) {
      const roles = normalizeArrayish(byRolesAtTenant[tid]);
      if (roles.length) {
        tenantsMap[tid] = tenantsMap[tid]
          ? { roles: uniq([...(tenantsMap[tid].roles || []), ...roles]) }
          : { roles: uniq(roles) };
      }
    }

    // Compat: si hay decoded.tenantId + decoded.roles (global) y no hay entry,
    // crea una entrada mínima para ese tenant.
    if (decoded.tenantId && !tenantsMap[decoded.tenantId] && globalRoles.length) {
      tenantsMap[decoded.tenantId] = { roles: uniq(globalRoles) };
    }

    const hasTenants = Object.keys(tenantsMap).length > 0;

    return {
      uid: decoded.uid,
      email: decoded.email,
      roles: globalRoles,               // <-- se mantiene
      tenants: hasTenants ? tenantsMap : undefined, // <-- opcional
    };
  } catch {
    return null;
  }
}

/**
 * Valida rol admin.
 * - Legacy (sin tenant resuelto): requiere admin/superadmin global → mantiene compatibilidad.
 * - Con tenant (x-tenant-id o path "/:tenantId/..."): acepta admin/owner/superadmin en ese tenant o admin/superadmin global.
 */
export async function requireAdmin(req: NextRequest): Promise<ServerUser> {
  const user = await getUserFromRequest(req);
  if (!user) throw new Error("Unauthorized");

  // Resolver tenant implícito (no cambiamos firma):
  const headerTid = req.headers.get("x-tenant-id") || undefined;
  const pathTid = tenantFromPath(req);
  const tenantId = headerTid || pathTid;

  // 1) Global (retro-compatible)
  const isGlobalAdmin =
    user.roles.includes("admin") || user.roles.includes("superadmin");
  if (!tenantId) {
    if (isGlobalAdmin) return user;
    throw new Error("Forbidden");
  }

  // 2) Por-tenant (si hay mapa)
  const tenantRoles = user.tenants?.[tenantId]?.roles || [];
  const isTenantAdmin = tenantRoles.some((r) =>
    r === "admin" || r === "owner" || r === "superadmin"
  );

  if (isGlobalAdmin || isTenantAdmin) return user;
  throw new Error("Forbidden");
}
