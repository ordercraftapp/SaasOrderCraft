// src/lib/server/roles.ts
import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/server/auth";

const json = (d: unknown, s = 403) => NextResponse.json(d, { status: s });

export type AppRole = "admin" | "kitchen" | "waiter" | "delivery";

export function isAdmin(user: any) {
  return user?.role === "admin" || user?.isAdmin === true || user?.claims?.admin === true;
}

export function hasRole(user: any, role: AppRole) {
  if (isAdmin(user)) return true;
  return user?.claims?.[role] === true || user?.roles?.[role] === true;
}

export async function requireAnyRole(req: NextRequest, roles: AppRole[]) {
  const user = await getUserFromRequest(req);
  if (!user) return { ok: false as const, res: json({ error: "Auth requerida" }, 401) };
  if (roles.some((r) => hasRole(user, r))) return { ok: true as const, user };
  return { ok: false as const, res: json({ error: "Forbidden" }, 403) };
}
