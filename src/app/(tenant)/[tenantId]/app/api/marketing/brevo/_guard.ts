// src/app/(tenant)/[tenant]/app/api/marketing/brevo/_guard.ts

import { NextRequest, NextResponse } from "next/server";
import { getAdminDB } from "@/lib/firebase/admin";
// Importa la implementación original y la envolvemos para normalizar headers
import { getUserFromRequest as _getUserFromRequest } from "@/lib/server/auth";

/** JSON helper (respuesta tipada) */
export function json(data: any, status = 200) {
  return new NextResponse(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Exponemos una instancia lista del Admin DB para compatibilidad */
export const db = getAdminDB();

/** Normaliza el token desde Authorization: Bearer <idToken> o x-id-token: <idToken> */
function extractToken(req: NextRequest): string | null {
  const auth = req.headers.get("authorization") || req.headers.get("x-id-token") || "";
  if (!auth) return null;
  return auth.startsWith("Bearer ") ? auth.slice(7).trim() : auth.trim();
}

/**
 * Wrapper que garantiza que _getUserFromRequest reciba un header Authorization normalizado.
 * Si solo llega x-id-token, lo transformamos a Authorization: Bearer <token>.
 */
async function getUserFromRequest(req: NextRequest): Promise<any | null> {
  try {
    const token = extractToken(req);

    // Construimos un Request "plano" con los mismos headers y método,
    // inyectando Authorization si hace falta.
    const headers = new Headers(req.headers);
    if (token && !headers.get("authorization")) {
      headers.set("authorization", `Bearer ${token}`);
    }

    // Importante: NextRequest.body es un ReadableStream; no lo releemos aquí.
    // _getUserFromRequest usualmente solo consulta headers/cookies.
    const fake = new Request(req.url, {
      method: req.method,
      headers,
      // Nota: no pasamos body porque muchas implementaciones no lo requieren para auth
      // y reusar el stream puede romper el request original en Next.
    });

    return await _getUserFromRequest(fake as any);
  } catch {
    return null;
  }
}

/** Opciones para autorización por rol (global o por tenant) */
type RequireAdminOptions = {
  tenantId?: string;
  roles?: string[]; // default ampliado
};

/** Roles por defecto aceptados (puedes ajustar esta lista si lo necesitas) */
const DEFAULT_ADMIN_ROLES = ["admin", "owner", "superadmin"] as const;

/**
 * Autorización mínima:
 * - Si opts.tenantId existe e implementaste roles por tenant en `me.tenants[tenantId].role`,
 *   valida contra esa fuente.
 * - Si no, cae a `me.role` global.
 * Retorna el usuario si está autorizado; si no, `null`.
 */
export async function requireAdmin(
  req: NextRequest,
  opts: RequireAdminOptions = {}
) {
  const me: any = await getUserFromRequest(req);
  if (!me) return null;

  const roles = opts.roles ?? Array.from(DEFAULT_ADMIN_ROLES);
  const tId = opts.tenantId;

  // 1) Intentar autorización scopiada al tenant (si tu objeto usuario la trae)
  if (tId && me.tenants && typeof me.tenants === "object") {
    const tenantRole = me.tenants?.[tId]?.role;
    if (tenantRole && roles.includes(tenantRole)) return me;
  }

  // 2) Fallback: rol global
  if (me.role && roles.includes(me.role)) return me;

  return null;
}

/**
 * Helper opcional para devolver 403 con pista en dev.
 * Úsalo en rutas si quieres más diagnóstico:
 *
 *   if (!me) return forbidden(req, { tenantId });
 */
export function forbidden(req: NextRequest, extra?: Record<string, any>) {
  const debug = req.headers.get("x-debug-auth") === "1";
  if (debug) {
    return json(
      {
        error: "Forbidden",
        hint: "Missing role or invalid token for this tenant.",
        ...(extra || {}),
      },
      403
    );
  }
  return json({ error: "Forbidden" }, 403);
}
