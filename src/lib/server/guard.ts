// src/lib/server/guard.ts
import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/server/auth";

// Define los roles operativos
export type OpRole = "admin" | "kitchen" | "waiter" | "delivery" | "cashier";

/** Intenta obtener los claims sin importar la forma en que tu auth los exponga */
function extractClaims(user: any): any | null {
  if (!user) return null;
  // Formato ideal: { uid, claims }
  if (user.claims) return user.claims;
  // Variantes comunes
  if (user.token) return user.token;               // algunos devuelven el decoded token como "token"
  if ((user as any).decodedToken) return (user as any).decodedToken;
  if ((user as any).customClaims) return (user as any).customClaims;
  return null;
}

/** Verifica si los claims contienen alguno de los roles requeridos */
function hasRequiredRole(claims: any, roles: OpRole[]): boolean {
  const c = claims || {};
  const isAdmin = !!c.admin || c.role === "admin";
  const needs: Record<OpRole, boolean> = {
    admin: isAdmin || !!c.admin,
    kitchen: isAdmin || !!c.kitchen,
    waiter: isAdmin || !!c.waiter,
    delivery: isAdmin || !!c.delivery,
    cashier: isAdmin || !!c.cashier || c.role === "cashier",
  };
  return roles.some((r) => !!needs[r]);
}

/**
 * Guard para APIs (Route Handlers).
 * Uso:
 *   const denial = await requireRole(req, ["cashier"]);
 *   if (denial) return denial;
 *   // continuar...
 */
export async function requireRole(req: NextRequest, roles: OpRole[]) {
  // Nota: algunos getUserFromRequest aceptan Request nativa; por eso el cast.
  const user: any = await getUserFromRequest(req as any);

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const claims = extractClaims(user);
  if (!claims) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  if (!hasRequiredRole(claims, roles)) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // OK
  return null;
}
