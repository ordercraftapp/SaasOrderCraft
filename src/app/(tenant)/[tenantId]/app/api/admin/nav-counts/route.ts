// src/app/(tenant)/[tenantId]/app/api/admin/nav-counts/route.ts
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { resolveTenantFromRequest, requireTenantId } from '@/lib/tenant/server';
import { tColAdmin } from '@/lib/db_admin';
import { getUserFromRequest } from '@/lib/server/auth';

const json = (d: unknown, s = 200) => NextResponse.json(d, { status: s });

/* =========================
   Helpers de roles por-tenant
   ========================= */
function normalizeTenantNode(node: any): Record<string, boolean> {
  if (!node) return {};
  if (node.roles && typeof node.roles === 'object') return { ...(node.roles as any) };
  return { ...(node as any) };
}
function hasRoleGlobal(claims: any, role: string) {
  return !!(
    claims &&
    (claims[role] === true ||
      (Array.isArray(claims.roles) && claims.roles.includes(role)) ||
      claims.role === role)
  );
}
function hasRoleTenant(claims: any, tenantId: string, role: string) {
  const node = claims?.tenants?.[tenantId];
  const flags = normalizeTenantNode(node);
  return !!flags?.[role];
}
/** Staff permitido para ver contadores:
 *  - por-tenant: admin, kitchen, cashier, delivery
 *  - global (compat): admin, waiter
 */
function isStaffForTenant(u: any, tenantId: string) {
  const claims = u?.claims ?? u?.token ?? u;
  return (
    hasRoleTenant(claims, tenantId, 'admin')   ||
    hasRoleTenant(claims, tenantId, 'kitchen') ||
    hasRoleTenant(claims, tenantId, 'cashier') ||
    hasRoleTenant(claims, tenantId, 'delivery')||
    hasRoleGlobal(claims, 'admin') ||          // compat legacy
    hasRoleGlobal(claims, 'waiter')            // compat legacy
  );
}

export async function GET(req: NextRequest, { params }: { params: { tenantId: string } }) {
  try {
    // 🔐 Auth
    const user = await getUserFromRequest(req);
    if (!user) return json({ ok: false, error: 'Unauthorized' }, 401);

    // 🔐 Tenant
    const tenantId = requireTenantId(
      resolveTenantFromRequest(req, params),
      'api:admin/nav-counts'
    );

    if (!isStaffForTenant(user, tenantId)) {
      return json({ ok: false, error: 'Forbidden' }, 403);
    }

    // 🗂️ Colección Admin (tenants/{tenantId}/orders)
    const col = tColAdmin('orders', tenantId);

    // 1) Kitchen pendientes: 'placed' + 'kitchen_in_progress'
    const qKitchen = col.where('status', 'in', ['placed', 'kitchen_in_progress']);

    // 2) Cashier queue: 'kitchen_done' + 'ready_to_close'
    //    ✅ Incluir explícitamente dine_in y pickup (normalizado en 'type')
    const cashierStatuses = ['kitchen_done', 'ready_to_close'] as const;
    const qCashierType = col
      .where('status', 'in', cashierStatuses as unknown as string[])
      .where('type', 'in', ['dine_in', 'pickup']);

    //    🔁 Fallback legacy: algunos docs antiguos guardan el tipo en orderInfo.type
    const qCashierLegacy = col
      .where('status', 'in', cashierStatuses as unknown as string[])
      .where('orderInfo.type', 'in', ['dine-in', 'pickup']);

    // 3) Delivery pendientes:
    //    type = 'delivery' y status en tránsito
    const qDelivery = col
      .where('type', '==', 'delivery')
      .where('status', 'in', ['assigned_to_courier', 'on_the_way']);

    // 🔢 Aggregation count()
    const [c1, c2Type, c3, c2Legacy] = await Promise.all([
      qKitchen.count().get(),
      qCashierType.count().get(),
      qDelivery.count().get(),
      qCashierLegacy.count().get(),
    ]);

    const kitchenPending = c1.data().count || 0;

    // 🧠 Evitar doble conteo: priorizamos esquema normalizado.
    // Si el normalizado arroja >0, usamos ese valor. Si da 0 (dataset legacy),
    // usamos el legacy. Así no sumamos dos veces documentos que tengan ambos campos.
    let cashierQueue = c2Type.data().count || 0;
    if (cashierQueue === 0) {
      cashierQueue = c2Legacy.data().count || 0;
    }

    const deliveryPending = c3.data().count || 0;

    return json({
      ok: true,
      kitchenPending,
      cashierQueue,     // ✅ ya incluye pickup
      deliveryPending,
      ts: new Date().toISOString(),
    });
  } catch (e: any) {
    console.error('[GET /app/api/admin/nav-counts] error:', e);
    return json({ ok: false, error: e?.message || 'Server error' }, 500);
  }
}
