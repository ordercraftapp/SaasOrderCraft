// src/app/(tenant)/[tenant]/app/api/marketing/brevo/_guard.ts
import { NextRequest, NextResponse } from "next/server";
import { getAdminDB, adminAuth } from "@/lib/firebase/admin";

export function json(data: any, status = 200) {
  return new NextResponse(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

export const db = getAdminDB();

// Roles aceptados por defecto para “admin”
const DEFAULT_ADMIN_ROLES = ["admin", "owner", "superadmin"] as const;

type RequireAdminOptions = {
  tenantId?: string;      // el tenant esperado (p.ej. "vale")
  roles?: string[];       // lista de roles aceptados; por defecto admin/owner/superadmin
};

type MeUser = {
  uid: string;
  email?: string | null;

  // Roles desde Firestore (users/{uid})
  role?: string | null; // global
  tenants?:
    | Record<
        string,
        {
          role?: string | null; // por-tenant (modelo antiguo)
          [k: string]: any;
        }
      >
    | null;

  // Claims crudos del token (nuevos)
  _claims?: {
    role?: string | null;                    // e.g. "admin"
    roles?: Record<string, boolean> | null;  // e.g. { admin: true }
    tenants?: Record<string, { roles?: Record<string, boolean> | null }>;
  } | null;

  [k: string]: any;
};

function extractToken(req: NextRequest): string | null {
  const auth = req.headers.get("authorization") || req.headers.get("x-id-token") || "";
  if (!auth) return null;
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : auth.trim();
}

function dbg(req: NextRequest) {
  const enabled = req.headers.get("x-debug-auth") === "1";
  const tag = "[auth]";
  return {
    enabled,
    log: (...args: any[]) => {
      if (enabled) console.log(tag, ...args);
    },
    error: (...args: any[]) => {
      if (enabled) console.error(tag, ...args);
    },
  };
}

/** Util: verifica si un mapa tipo { admin: true, cashier: true } contiene alguno de los roles esperados */
function hasAnyAcceptedRoleInMap(
  rolesMap: Record<string, boolean> | null | undefined,
  accepted: string[]
): boolean {
  if (!rolesMap) return false;
  for (const r of accepted) {
    if (rolesMap[r] === true) return true;
  }
  return false;
}

async function resolveMeFromToken(req: NextRequest): Promise<MeUser | null> {
  const d = dbg(req);
  try {
    const token = extractToken(req);
    if (!token) {
      d.log("no token found in headers (authorization / x-id-token)");
      return null;
    }
    d.log("token present (len):", token.length);

    // 1) Verificar idToken
    let decoded: any;
    try {
      decoded = await adminAuth.verifyIdToken(token, true);
      d.log("verifyIdToken OK → uid:", decoded?.uid, " email:", decoded?.email || null);
    } catch (e: any) {
      d.error("verifyIdToken FAILED:", e?.message || e);
      return null;
    }

    const uid = decoded.uid as string;
    const email = (decoded.email || "").toLowerCase() || null;

    // 2) Claims “a lo rules” (compatibles con tus reglas de seguridad)
    const claimRole = (decoded as any)?.role ?? null;                    // p.ej. "admin"
    const claimRoles = ((decoded as any)?.roles ?? null) as Record<string, boolean> | null;
    const claimTenants = ((decoded as any)?.tenants ?? null) as Record<
      string,
      { roles?: Record<string, boolean> | null }
    > | null;

    // 3) Enriquecer con users/{uid} (opcional; no requerido si usas solo claims)
    let fsRole: string | null = null;
    let fsTenants: MeUser["tenants"] = null;
    try {
      const userDoc = await db.doc(`users/${uid}`).get();
      if (userDoc.exists) {
        const data = userDoc.data() as any;
        fsRole = data?.role ?? null;
        fsTenants = data?.tenants && typeof data.tenants === "object" ? data.tenants : null;
        d.log(
          "users/{uid} doc found:",
          !!userDoc.exists,
          "role:",
          fsRole,
          "tenants keys:",
          fsTenants ? Object.keys(fsTenants) : null
        );
      } else {
        d.log("users/{uid} doc not found → using token-only identity");
      }
    } catch (e: any) {
      d.error("Firestore users/{uid} read FAILED:", e?.message || e);
    }

    // 4) Devolvemos objeto identidad con ambas fuentes (Firestore + claims)
    return {
      uid,
      email,
      role: fsRole ?? null,        // preferimos el FS para “role” global (si existe)
      tenants: fsTenants ?? null,  // y FS para tenants (si existe)
      _claims: {
        role: claimRole ?? null,
        roles: claimRoles ?? null,
        tenants: claimTenants ?? undefined,
      },
    };
  } catch (e: any) {
    dbg(req).error("resolveMeFromToken UNEXPECTED ERROR:", e?.message || e);
    return null;
  }
}

export async function requireAdmin(req: NextRequest, opts: RequireAdminOptions = {}) {
  const d = dbg(req);
  const me = await resolveMeFromToken(req);

  if (!me) {
    d.log("requireAdmin → me=null (invalid/missing token)");
    return null;
  }

  const accepted = opts.roles ?? Array.from(DEFAULT_ADMIN_ROLES);
  const tId = opts.tenantId;

  d.log("requireAdmin input:", {
    tenantId: tId,
    acceptedRoles: accepted,
    meRoleGlobal_FS: me.role ?? null,
    hasFS_tenants: !!me.tenants,
    hasClaims: !!me._claims,
  });

  // === 1) Autorización por-tenant (Firestore: users/{uid}.tenants[tenantId].role === alguno de accepted)
  if (tId && me.tenants && typeof me.tenants === "object") {
    const fsTenantRole = (me.tenants as any)?.[tId]?.role || null;
    d.log("FS tenantRole for", tId, "=", fsTenantRole);
    if (fsTenantRole && accepted.includes(fsTenantRole)) {
      d.log("AUTHORIZED by FS tenant role");
      return me;
    }
  }

  // === 2) Autorización por-tenant via CLAIMS: tenants[tenantId].roles = { admin: true, ... }
  if (tId && me._claims?.tenants && typeof me._claims.tenants === "object") {
    const claimsTenantRoles = me._claims.tenants[tId]?.roles ?? null;
    d.log("Claim tenant roles map for", tId, "=", claimsTenantRoles);
    if (hasAnyAcceptedRoleInMap(claimsTenantRoles || null, accepted)) {
      d.log("AUTHORIZED by tenant claim roles map");
      return me;
    }
  }

  // === 3) Rol global (Firestore): users/{uid}.role
  if (me.role && accepted.includes(me.role)) {
    d.log("AUTHORIZED by FS global role");
    return me;
  }

  // === 4) Rol global via CLAIMS
  // 4a) claim.role = "admin"
  const claimRole = me._claims?.role ?? null;
  if (claimRole && accepted.includes(claimRole)) {
    d.log("AUTHORIZED by global claim.role");
    return me;
  }
  // 4b) claim.roles = { admin: true }
  const claimRoles = me._claims?.roles ?? null;
  if (hasAnyAcceptedRoleInMap(claimRoles || null, accepted)) {
    d.log("AUTHORIZED by global claim roles map");
    return me;
  }

  d.log("NOT AUTHORIZED → returning null");
  return null;
}

export function forbidden(req: NextRequest, extra?: Record<string, any>) {
  const d = dbg(req);
  if (d.enabled) {
    return json(
      {
        error: "Forbidden",
        hint:
          "Falta rol autorizado para este tenant o token inválido/expirado. Verifica Authorization: Bearer <idToken> y roles (global o por tenant).",
        ...(extra || {}),
      },
      403
    );
  }
  return json({ error: "Forbidden" }, 403);
}

/** Helper opcional para distinguir 401 (sin token / inválido) de 403 (sin rol) */
export function unauthorized(req: NextRequest, extra?: Record<string, any>) {
  const d = dbg(req);
  if (d.enabled) {
    return json(
      {
        error: "Unauthorized",
        hint: "Token ausente o inválido",
        ...(extra || {}),
      },
      401
    );
  }
  return json({ error: "Unauthorized" }, 401);
}
