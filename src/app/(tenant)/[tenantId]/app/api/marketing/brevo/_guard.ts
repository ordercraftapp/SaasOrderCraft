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

/** Exponemos una instancia lista del Admin DB para compatibilidad */
export const db = getAdminDB();

/** Roles por defecto aceptados (ajústalos si hace falta) */
const DEFAULT_ADMIN_ROLES = ["admin", "owner", "superadmin"] as const;

/** Opciones para autorización por rol (global o por tenant) */
type RequireAdminOptions = {
  tenantId?: string;
  roles?: string[]; // default ampliado
};

/** Estructura mínima que esperamos de "me" */
type MeUser = {
  uid: string;
  email?: string | null;
  role?: string | null; // rol global
  tenants?: Record<
    string,
    {
      role?: string | null;
      [k: string]: any;
    }
  > | null;
  [k: string]: any;
};

/** Lee idToken desde Authorization: Bearer <token> o x-id-token */
function extractToken(req: NextRequest): string | null {
  const auth = req.headers.get("authorization") || req.headers.get("x-id-token") || "";
  if (!auth) return null;
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : auth.trim();
}

/**
 * Verifica el idToken con Firebase Admin y arma un objeto "me".
 * - Si existe doc en `users/{uid}`, se fusiona para tomar `role` global y `tenants`.
 * - Si no existe doc, al menos retorna uid/email del token.
 */
async function resolveMeFromToken(req: NextRequest): Promise<MeUser | null> {
  try {
    const token = extractToken(req);
    if (!token) return null;

    // Verifica idToken (NO cookies). Lanza si es inválido/expirado.
    const decoded = await adminAuth.verifyIdToken(token, true);
    const uid = decoded.uid;
    const email = (decoded.email || "").toLowerCase() || null;

    // Intentar enriquecer desde Firestore: users/{uid}
    let role: string | null = null;
    let tenants: MeUser["tenants"] = null;

    try {
      const userDoc = await db.doc(`users/${uid}`).get();
      if (userDoc.exists) {
        const data = userDoc.data() as any;
        role = data?.role ?? null;
        tenants = data?.tenants && typeof data.tenants === "object" ? data.tenants : null;
      }
    } catch {
      // Si falla Firestore, continuamos con datos del token
    }

    const me: MeUser = {
      uid,
      email,
      role,
      tenants,
      // Puedes incluir claims del token si te interesa auditarlos:
      // claims: decoded,
    };

    return me;
  } catch {
    return null;
  }
}

/**
 * Autorización mínima con verificación directa de idToken:
 * - Si opts.tenantId existe y hay rol por tenant en `me.tenants[tenantId].role`, se valida.
 * - Si no, cae a `me.role` global.
 * Retorna el usuario si está autorizado; si no, `null`.
 */
export async function requireAdmin(
  req: NextRequest,
  opts: RequireAdminOptions = {}
) {
  const me = await resolveMeFromToken(req);
  if (!me) return null;

  const roles = opts.roles ?? Array.from(DEFAULT_ADMIN_ROLES);
  const tId = opts.tenantId;

  // 1) Intentar autorización scopiada al tenant
  if (tId && me.tenants && typeof me.tenants === "object") {
    const tenantRole = (me.tenants as any)?.[tId]?.role;
    if (tenantRole && roles.includes(tenantRole)) return me;
  }

  // 2) Fallback: rol global
  if (me.role && roles.includes(me.role)) return me;

  return null;
}

/**
 * Helper opcional para devolver 403 con pista en dev.
 * Úsalo en rutas si quieres más diagnóstico:
 *   if (!me) return forbidden(req, { tenantId });
 *
 * En el cliente, agrega el header x-debug-auth: 1 para ver pistas.
 */
export function forbidden(req: NextRequest, extra?: Record<string, any>) {
  const debug = req.headers.get("x-debug-auth") === "1";
  if (debug) {
    return json(
      {
        error: "Forbidden",
        hint:
          "No rol autorizado para este tenant o token inválido/expirado. Verifica Authorization: Bearer <idToken> y roles.",
        ...(extra || {}),
      },
      403
    );
  }
  return json({ error: "Forbidden" }, 403);
}
