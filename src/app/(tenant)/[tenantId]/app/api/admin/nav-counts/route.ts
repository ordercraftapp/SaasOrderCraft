// src/app/(tenant)/[tenantId]/app/api/admin/nav-counts/route.ts
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { resolveTenantFromRequest, requireTenantId } from '@/lib/tenant/server';
import { tColAdmin } from '@/lib/db_admin';
import { getUserFromRequest } from '@/lib/server/auth';
import { adminAuth } from '@/lib/firebase/admin';

const json = (d: unknown, s = 200) => NextResponse.json(d, { status: s });

/* =========================
   Helpers de auth y roles
   ========================= */
async function getUserFromAuthHeader(req: NextRequest) {
  const hdr = req.headers.get('authorization') || req.headers.get('Authorization');
  if (!hdr || !hdr.toLowerCase().startsWith('bearer ')) return null;
  const token = hdr.slice(7).trim();
  try {
    const decoded = await adminAuth.verifyIdToken(token, true);
    return decoded as any; // { uid, tenants?, role?, roles?[] ... }
  } catch {
    return null;
  }
}

function extractClaims(u: any) {
  // Soporta {claims}, {token} o el decoded directo
  return u?.claims ?? u?.token ?? u ?? {};
}
function normalizeTenantNode(node: any): Record<string, boolean> {
  if (!node || typeof node !== 'object') return {};
  const res: Record<string, boolean> = {};
  const merge = (src: any) => {
    if (src && typeof src === 'object') {
      for (const k of Object.keys(src)) {
        if (typeof src[k] === 'boolean') res[k] = res[k] || !!src[k];
      }
    }
  };
  merge(node);                // plano {admin:true, kitchen:true}
  merge(node.roles);          // {roles:{...}}
  merge(node.flags);          // {flags:{...}}
  merge(node.rolesNormalized);// {rolesNormalized:{...}}
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
function hasAnyTenantRole(claims: any, tenantId: string, roles: string[]) {
  const node = claims?.tenants?.[tenantId];
  const flags = normalizeTenantNode(node);
  return roles.some((r) => !!flags[r]);
}

/* ============================== Handler ============================== */
export async function GET(req: NextRequest, { params }: { params: { tenantId: string } }) {
  try {
    // 🔐 Tenant del path
    const tenantId = requireTenantId(
      resolveTenantFromRequest(req, params),
      'api:admin/nav-counts'
    );

    // 1) Preferimos el ID token del Authorization header (claims frescos)
    let user: any = await getUserFromAuthHeader(req);

    // 2) Fallback a tu helper (puede devolver sesión sin tenants)
    if (!user) user = await getUserFromRequest(req);
    if (!user) return json({ ok: false, error: 'Unauthorized' }, 401);

    // 3) Si aún no vemos tenants, hacemos fallback a customClaims del Admin SDK
    let claims = extractClaims(user);
    if (!claims?.tenants || !claims.tenants[tenantId]) {
      try {
        const uid = claims?.uid || user?.uid;
        if (uid) {
          const rec = await adminAuth.getUser(uid);
          const cc = (rec?.customClaims ?? {}) as any;
          // Unimos superficialmente para no perder nada global
          claims = { ...claims, ...cc };
        }
      } catch {}
    }

    // 🔎 Diagnóstico (bórralo luego)
    try {
      const tNode = claims?.tenants?.[tenantId];
      const normalized = normalizeTenantNode(tNode);
      console.log('[nav-counts:v2] tenantId=', tenantId, {
        hasTenants: !!claims?.tenants,
        tenantKeys: Object.keys(claims?.tenants || {}),
        tNodeKeys: tNode ? Object.keys(tNode) : null,
        flagsTrue: Object.keys(normalized).filter((k) => normalized[k]),
        topRole: claims?.role,
        rolesArr: claims?.roles,
      });
    } catch {}

    // ✅ Permisos: por-tenant admin/kitchen/cashier/delivery, o global (compat) admin/waiter
    const allowed =
      hasAnyTenantRole(claims, tenantId, ['admin', 'kitchen', 'cashier', 'delivery']) ||
      hasRoleGlobal(claims, 'admin') ||
      hasRoleGlobal(claims, 'waiter');

    if (!allowed) return json({ ok: false, error: 'Forbidden' }, 403);

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

    return json({
      ok: true,
      kitchenPending,
      cashierQueue,     // ✅ incluye pickup
      deliveryPending,
      ts: new Date().toISOString(),
    });
  } catch (e: any) {
    console.error('[GET /app/api/admin/nav-counts] error:', e);
    return json({ ok: false, error: e?.message || 'Server error' }, 500);
  }
}
