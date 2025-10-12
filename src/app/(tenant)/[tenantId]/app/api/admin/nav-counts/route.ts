// src/app/(tenant)/[tenantId]/app/api/admin/nav-counts/route.ts
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { resolveTenantFromRequest, requireTenantId } from '@/lib/tenant/server';
import { tColAdmin } from '@/lib/db_admin';
import { getUserFromRequest } from '@/lib/server/auth';

const json = (d: unknown, s = 200) => NextResponse.json(d, { status: s });

// Helpers de rol (admin/cashier/kitchen pueden ver)
function hasRole(u: any, r: string) {
  const tok = u?.token || u;
  return tok?.role === r || (Array.isArray(tok?.roles) && tok.roles.includes(r));
}
function isStaff(u: any) {
  return hasRole(u, 'admin') || hasRole(u, 'cashier') || hasRole(u, 'kitchen');
}

export async function GET(req: NextRequest, { params }: { params: { tenantId: string } }) {
  try {
    // 🔐 Auth
    const user = await getUserFromRequest(req);
    if (!user) return json({ ok: false, error: 'Unauthorized' }, 401);
    if (!isStaff(user)) return json({ ok: false, error: 'Forbidden' }, 403);

    // 🔐 Tenant
    const tenantId = requireTenantId(
      resolveTenantFromRequest(req, params),
      'api:admin/nav-counts'
    );

    // 🗂️ Colección de órdenes por tenant: tenants/{tenantId}/orders
    const col = tColAdmin('orders', tenantId);

    // 1) Kitchen pendientes (no "kitchen ready"): placed + kitchen_in_progress
    const qKitchen = col.where('status', 'in', ['placed', 'kitchen_in_progress']);

    // 2) Cashier queue: listas de cocina y no cerradas (ready_to_close / kitchen_done)
    const qCashier = col.where('status', 'in', ['kitchen_done', 'ready_to_close']);

    // 3) Delivery pendientes: type delivery y subestado != delivered
    const qDelivery = col
      .where('orderInfo.type', '==', 'delivery')
      .where('orderInfo.delivery', 'in', ['pending', 'assigned_to_courier', 'on_the_way']);

    // 🔢 Agregaciones count()
    const [c1, c2, c3] = await Promise.all([
      qKitchen.count().get(),
      qCashier.count().get(),
      qDelivery.count().get(),
    ]);

    const kitchenPending = c1.data().count || 0;
    const cashierQueue = c2.data().count || 0;
    const deliveryPending = c3.data().count || 0;

    return json({
      ok: true,
      kitchenPending,
      cashierQueue,
      deliveryPending,
      ts: new Date().toISOString(),
    });
  } catch (e: any) {
    console.error('[GET /api/admin/nav-counts] error:', e);
    return json({ ok: false, error: e?.message || 'Server error' }, 500);
  }
}
