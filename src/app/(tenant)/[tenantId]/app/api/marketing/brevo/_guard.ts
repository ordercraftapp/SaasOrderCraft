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

const DEFAULT_ADMIN_ROLES = ["admin", "owner", "superadmin"] as const;

type RequireAdminOptions = {
  tenantId?: string;
  roles?: string[];
};

type MeUser = {
  uid: string;
  email?: string | null;
  role?: string | null;
  tenants?:
    | Record<
        string,
        {
          role?: string | null;
          [k: string]: any;
        }
      >
    | null;
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

async function resolveMeFromToken(req: NextRequest): Promise<MeUser | null> {
  const d = dbg(req);
  try {
    const token = extractToken(req);
    if (!token) {
      d.log("no token found in headers (authorization / x-id-token)");
      return null;
    }
    d.log("token present (len):", token.length);

    let decoded: any;
    try {
      decoded = await adminAuth.verifyIdToken(token, true);
      d.log("verifyIdToken OK → uid:", decoded?.uid, " email:", decoded?.email || null);
    } catch (e: any) {
      d.error("verifyIdToken FAILED:", e?.message || e);
      return null;
    }

    const uid = decoded.uid;
    const email = (decoded.email || "").toLowerCase() || null;

    // Enriquecer con users/{uid}
    let role: string | null = null;
    let tenants: MeUser["tenants"] = null;

    try {
      const userDoc = await db.doc(`users/${uid}`).get();
      if (userDoc.exists) {
        const data = userDoc.data() as any;
        role = data?.role ?? null;
        tenants = data?.tenants && typeof data.tenants === "object" ? data.tenants : null;
        d.log("users/{uid} doc found:", !!userDoc.exists, "role:", role, "tenants keys:", tenants ? Object.keys(tenants) : null);
      } else {
        d.log("users/{uid} doc not found → using token-only identity");
      }
    } catch (e: any) {
      d.error("Firestore users/{uid} read FAILED:", e?.message || e);
    }

    return { uid, email, role, tenants };
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

  const roles = opts.roles ?? Array.from(DEFAULT_ADMIN_ROLES);
  const tId = opts.tenantId;

  d.log("requireAdmin input:", { tenantId: tId, acceptedRoles: roles, meRoleGlobal: me.role });

  // 1) Rol por tenant
  if (tId && me.tenants && typeof me.tenants === "object") {
    const tenantRole = (me.tenants as any)?.[tId]?.role || null;
    d.log("tenantRole for", tId, "=", tenantRole);
    if (tenantRole && roles.includes(tenantRole)) {
      d.log("AUTHORIZED by tenant role");
      return me;
    }
  } else {
    d.log("no tenantId or me.tenants not present");
  }

  // 2) Rol global
  if (me.role && roles.includes(me.role)) {
    d.log("AUTHORIZED by global role");
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
