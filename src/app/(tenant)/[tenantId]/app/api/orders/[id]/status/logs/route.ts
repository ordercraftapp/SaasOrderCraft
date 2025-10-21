// src/app/(tenant)/[tenant]/app/api/orders/[id]/status/logs/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getAdminDB } from "@/lib/firebase/admin";
import { getUserFromRequest } from "@/lib/server/auth";
import { resolveTenantFromRequest, requireTenantId } from "@/lib/tenant/server";

const json = (d: unknown, s = 200) => NextResponse.json(d, { status: s });

type Ctx = { params: { tenant: string; id: string } };

/** ===== Helpers de roles por-tenant (compat plano / {roles:{...}}) ===== */
function normalizeTenantNode(node: any): Record<string, boolean> {
  if (!node) return {};
  if (node.roles && typeof node.roles === "object") return { ...(node.roles as any) };
  return { ...(node as any) };
}
function hasRoleGlobal(claims: any, role: string) {
  return !!(
    claims &&
    (
      claims[role] === true ||
      (Array.isArray(claims.roles) && claims.roles.includes(role)) ||
      claims.role === role
    )
  );
}
function hasRoleTenant(claims: any, tenantId: string, role: string) {
  const node = claims?.tenants?.[tenantId];
  const flags = normalizeTenantNode(node);
  return !!flags?.[role];
}
/** Quién puede ver logs de status:
 *  - por-tenant: admin, kitchen, cashier, delivery
 *  - global legacy: admin o waiter
 */
function canViewLogs(claims: any, tenantId: string) {
  if (hasRoleTenant(claims, tenantId, "admin")) return true;
  if (hasRoleTenant(claims, tenantId, "kitchen")) return true;
  if (hasRoleTenant(claims, tenantId, "cashier")) return true;
  if (hasRoleTenant(claims, tenantId, "delivery")) return true;
  if (hasRoleGlobal(claims, "admin")) return true;   // compat
  if (hasRoleGlobal(claims, "waiter")) return true;  // compat
  return false;
}

export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    // 🔐 Usuario
    const user = await getUserFromRequest(req);
    if (!user) return json({ error: "Unauthorized" }, 401);

    // 🔐 Tenant del path
    const tenantId = requireTenantId(
      resolveTenantFromRequest(req, ctx.params),
      "api:orders/[id]/status/logs:GET"
    );

    // 🔐 Permisos por-tenant (con compat global)
    const claims = (user as any)?.claims ?? user;
    if (!canViewLogs(claims, tenantId)) {
      return json({ error: "Forbidden" }, 403);
    }

    // ⚙️ Parámetros
    const { searchParams } = new URL(req.url);
    const limitParam = Number(searchParams.get("limit") ?? 10);
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 50) : 10;

    const db = getAdminDB();
    const orderRef = db.collection(`tenants/${tenantId}/orders`).doc(ctx.params.id);

    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) return json({ error: "Not found" }, 404);

    // Subcolección de logs (desc por fecha)
    const logsSnap = await orderRef
      .collection("status_log")
      .orderBy("at", "desc")
      .limit(limit)
      .get();

    const items = logsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));

    return json({ ok: true, tenantId, orderId: ctx.params.id, items }, 200);
  } catch (e: any) {
    console.error("[GET /api/orders/:id/status/logs]", e);
    return json({ error: e?.message ?? "Server error" }, 500);
  }
}
