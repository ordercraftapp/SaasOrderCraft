// src/app/(tenant)/[tenantId]/app/api/admin/nav-counts/route.ts
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { resolveTenantFromRequest, requireTenantId } from '@/lib/tenant/server';
import { tColAdmin } from '@/lib/db_admin';
import { getUserFromRequest } from '@/lib/server/auth';

const json = (d: unknown, s = 200) => NextResponse.json(d, { status: s });

/* ============= Helpers de roles por-tenant (hiper tolerantes) ============= */
function extractClaims(u: any) {
  // getUserFromRequest puede devolver {claims}, el decoded directo, o {token}
  return u?.claims ?? u?.token ?? u ?? {};
}

function pickTruthyKeys(obj: any) {
  if (!obj || typeof obj !== 'object') return [];
  return Object.keys(obj).filter((k) => !!obj[k]);
}

function normalizeTenantNode(node: any): Record<string, boolean> {
  if (!node || typeof node !== 'object') return {};
  // Soporta: plano, roles, flags, rolesNormalized
  const res: Record<string, boolean> = {};
  const merge = (src: any) => {
    if (src && typeof src === 'object') {
      for (const k of Object.keys(src)) {
        if (typeof src[k] === 'boolean') res[k] = res[k] || !!src[k];
      }
    }
  };
  merge(node);
  merge(node.roles);
  merge(node.flags);
  merge(node.rolesNormalized);
  return res;
}

function hasRoleGlobal(claims: any, role: string) {
  return !!(
    claims &&
    (claims[role] === true ||
      (Array.isArray(claims.roles) && claims.roles.includes(role)) ||
      claims.role === role ||
      (role === 'admin' && claims.role === 'superadmin'))
  );
}

function hasRoleTenantAnyKey(claims: any, tenantId: string, roles: string[]) {
  const node = claims?.tenants?.[tenantId];
  const flags = normalizeTenantNode(node);
  return roles.some((r) => !!flags[r]);
}

function isStaffForTenant(u: any, tenantId: string) {
  const claims = extractClaims(u);

  // 🔎 LOG de diagnóstico (quítalo cuando todo quede OK)
  try {
    const tNode = claims?.tenants?.[tenantId];
    const n = normalizeTenantNode(tNode);
    console.log('[nav-counts] tenantId=', tenantId, {
      top_role: claims?.role,
      top_roles: claims?.roles,
      tenants_keys: Object.keys(claims?.tenants || {}),
      tenant_node_keys: tNode ? Object.keys(tNode) : null,
      tenant_flags_true: pickTruthyKeys(n),
    });
  } catch {}

  // Por-tenant (todas las variantes) + global legacy
  return (
    hasRoleTenantAnyKey(claims, tenantId, ['admin','kitchen','cashier','delivery']) ||
    hasRoleGlobal(claims, 'admin') ||
    hasRoleGlobal(claims, 'waiter')
  );
}

/* ============================== Handler ============================== */
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

    // 2) Cashier queue: 'kitchen_done' + 'ready_to_close' para dine_in/pickup
    const cashierStatuses = ['kitchen_done', 'ready_to_close'] as const;
    const qCashierType = col
      .where('status', 'in', cashierStatuses as unknown as string[])
      .where('type', 'in', ['dine_in', 'pickup']);

    // Fallback legacy: orderInfo.type ('dine-in'|'pickup')
    const qCashierLegacy = col
      .where('status', 'in', cashierStatuses as unknown as string[])
      .where('orderInfo.type', 'in', ['dine-in', 'pickup']);

    // 3) Delivery pendientes: type delivery con estados en tránsito
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
    let cashierQueue = c2Type.data().count || 0;
    if (cashierQueue === 0) cashierQueue = c2Legacy.data().count || 0;
    const deliveryPending = c3.data().count || 0;

    return json({ ok: true, kitchenPending, cashierQueue, deliveryPending, ts: new Date().toISOString() });
  } catch (e: any) {
    console.error('[GET /app/api/admin/nav-counts] error:', e);
    return json({ ok: false, error: e?.message || 'Server error' }, 500);
  }
}
