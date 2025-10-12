// src/app/(tenant)/[tenant]/app/api/marketing/brevo/_guard.ts

import { NextRequest, NextResponse } from "next/server";
import { getAdminDB } from "@/lib/firebase/admin";
import { getUserFromRequest } from "@/lib/server/auth";

/** JSON helper (respuesta tipada) */
export function json(data: any, status = 200) {
  return new NextResponse(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json" },
  });
}

/** Exponemos una instancia lista del Admin DB para compatibilidad */
export const db = getAdminDB();

/** Opciones para autorización por rol (global o por tenant) */
type RequireAdminOptions = {
  tenantId?: string;
  roles?: string[]; // por defecto: ['admin']
};

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
  const me: any = await getUserFromRequest(req as any);
  if (!me) return null;

  const roles = opts.roles ?? ["admin"];
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
