// src/app/(tenant)/[tenant]/app/api/marketing/brevo/_guard.ts
import { NextRequest, NextResponse } from "next/server";
import { getAdminDB, adminAuth } from "@/lib/firebase/admin";

/** JSON helper (respuesta tipada) */
export function json(data: any, status = 200) {
  return new NextResponse(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Admin DB export */
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
  tenants?: Record<string, { role?: string | null; [k: string]: any }> | null;
  _debug?: Record<string, any>;
};

function extractToken(req: NextRequest): { token: string | null; source: "authorization"|"x-id-token"|"none" } {
  const auth = req.headers.get("authorization");
  if (auth && auth.trim()) {
    const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : auth.trim();
    return { token: token || null, source: "authorization" };
  }
  const xid = req.headers.get("x-id-token");
  if (xid && xid.trim()) {
    return { token: xid.trim(), source: "x-id-token" };
  }
  return { token: null, source: "none" };
}

function redact(token?: string | null) {
  if (!token) return null;
  if (token.length <= 12) return `${token.slice(0, 4)}…`;
  return `${token.slice(0, 8)}…${token.slice(-4)}`;
}

/** Devuelve true si hay header x-debug-auth: 1 */
function isDebug(req: NextRequest) {
  return req.headers.get("x-debug-auth") === "1";
}

/** Verifica idToken con Firebase y arma "me" + _debug */
async function resolveMeFromToken(req: NextRequest): Promise<MeUser | null> {
  const { token, source } = extractToken(req);
  const debugOn = isDebug(req);

  const dbg: Record<string, any> = {
    tokenSource: source,
    hasToken: !!token,
    tokenPreview: redact(token),
    step: "start",
  };

  if (!token) {
    if (debugOn) console.warn("[AUTH] No token found. Expected Authorization: Bearer <idToken> or x-id-token.");
    return { uid: "", _debug: { ...dbg, reason: "no_token" } } as any;
  }

  try {
    dbg.step = "verifyIdToken";
    const decoded = await adminAuth.verifyIdToken(token, true);
    const uid = decoded.uid;
    const email = (decoded.email || "").toLowerCase() || null;
    dbg.decoded = { uid, email, auth_time: decoded.auth_time, iss: decoded.iss, aud: decoded.aud };

    // Enriquecer desde Firestore: users/{uid}
    dbg.step = "fetchUserDoc";
    let role: string | null = null;
    let tenants: MeUser["tenants"] = null;

    try {
      const snap = await db.doc(`users/${uid}`).get();
      dbg.userDocExists = snap.exists;
      if (snap.exists) {
        const data = snap.data() as any;
        role = data?.role ?? null;
        tenants = data?.tenants && typeof data.tenants === "object" ? data.tenants : null;
        dbg.userDocRole = role || null;
        dbg.userDocTenantsKeys = tenants ? Object.keys(tenants) : [];
      } else {
        dbg.userDocRole = null;
        dbg.userDocTenantsKeys = [];
      }
    } catch (e: any) {
      dbg.userDocError = e?.message || String(e);
      if (debugOn) console.error("[AUTH] Firestore users/{uid} read error:", e);
    }

    const me: MeUser = { uid, email, role, tenants, _debug: dbg };
    if (debugOn) console.log("[AUTH] me:", { uid, email, role, tenants: dbg.userDocTenantsKeys });
    return me;
  } catch (e: any) {
    dbg.verifyError = e?.message || String(e);
    if (debugOn) console.error("[AUTH] verifyIdToken failed:", e);
    return { uid: "", _debug: { ...dbg, reason: "verify_failed" } } as any;
  }
}

/**
 * Devuelve 403 con detalle si x-debug-auth: 1; genérico si no.
 */
export function forbiddenDebug(req: NextRequest, why: Record<string, any> = {}) {
  if (isDebug(req)) {
    console.warn("[AUTH] Forbidden:", why);
    return json({ error: "Forbidden", hint: "Auth failed / role not allowed for tenant.", ...why }, 403);
  }
  return json({ error: "Forbidden" }, 403);
}

/**
 * requireAdmin con diagnóstico: retorna "me" si autorizado; si no, null.
 * Para ver el motivo exacto, responde con forbiddenDebug(req, info).
 */
export async function requireAdmin(req: NextRequest, opts: RequireAdminOptions = {}) {
  const me = await resolveMeFromToken(req);
  const roles = opts.roles ?? Array.from(DEFAULT_ADMIN_ROLES);
  const tId = opts.tenantId;
  const dbg = (me && (me as any)._debug) || {};

  // token inválido o no presente
  if (!me || !me.uid) {
    (dbg.reason ||= "no_me_uid");
    (dbg.rolesAccepted ||= roles);
    (dbg.tenantId ||= tId ?? null);
    (dbg.where ||= "requireAdmin.start");
    (dbg.note ||= "Missing uid (no token / invalid token)");
    (dbg.me ||= me);
    // devolvemos null; la ruta debe llamar forbiddenDebug para explicar
    return null;
  }

  // 1) rol por tenant
  if (tId && me.tenants && typeof me.tenants === "object") {
    const tenantRole = (me.tenants as any)?.[tId]?.role || null;
    if (tenantRole) {
      if (roles.includes(tenantRole)) {
        return me;
      } else {
        (dbg.reason ||= "tenant_role_not_allowed");
        (dbg.tenantRole ||= tenantRole);
        (dbg.rolesAccepted ||= roles);
        (dbg.tenantId ||= tId);
        (dbg.where ||= "requireAdmin.tenantRole");
        (me as any)._debug = dbg;
        return null;
      }
    } else {
      (dbg.reason ||= "no_tenant_role");
      (dbg.tenantRole ||= null);
      (dbg.rolesAccepted ||= roles);
      (dbg.tenantId ||= tId);
      (dbg.where ||= "requireAdmin.noTenantRole");
      (me as any)._debug = dbg;
      // seguimos al fallback global
    }
  }

  // 2) rol global
  if (me.role && roles.includes(me.role)) {
    return me;
  }

  (dbg.reason ||= "global_role_not_allowed_or_missing");
  (dbg.globalRole ||= me.role ?? null);
  (dbg.rolesAccepted ||= roles);
  (dbg.tenantId ||= tId ?? null);
  (dbg.where ||= "requireAdmin.globalRole");
  (me as any)._debug = dbg;
  return null;
}
