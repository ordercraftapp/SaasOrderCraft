export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { Timestamp } from 'firebase-admin/firestore';
import { normalizeTenantId, assertValidTenantId } from '@/lib/tenant/validate';

type PlanId = 'starter' | 'pro' | 'full';

const PLAN_PRICE_CENTS: Record<PlanId, number> = {
  starter: 1999,
  pro: 2999,
  full: 3499,
};

function json(d: unknown, s = 200) {
  return NextResponse.json(d, { status: s });
}

export async function POST(req: NextRequest) {
  try {
    const { tenantId: rawTenant, orderId, newPlan } = await req.json() as {
      tenantId?: string; orderId?: string; newPlan?: PlanId;
    };

    const tenantId = normalizeTenantId(String(rawTenant || ''));
    if (!tenantId || !orderId || !newPlan) return json({ error: 'Missing tenantId, orderId or newPlan' }, 400);
    assertValidTenantId(tenantId);
    if (!['starter', 'pro', 'full'].includes(newPlan)) return json({ error: 'Invalid plan' }, 400);

    const amountCents = PLAN_PRICE_CENTS[newPlan];
    const currency = 'USD';
    const now = Timestamp.now();

    const tOrderRef = adminDb.doc(`tenants/${tenantId}/tenantOrders/${orderId}`);
    const flatRef   = adminDb.collection('tenantOrders').doc(`${tenantId}__${orderId}`);

    // Leer la orden actual (para validar existencia y preservar campos)
    const snap = await tOrderRef.get();
    if (!snap.exists) return json({ error: 'Order not found' }, 404);
    const cur = snap.data() || {};

    // Actualizar MISMA orden (tipo upgrade) + mirror plano (compat. con PayPal APIs existentes)
    await Promise.all([
      tOrderRef.set({
        planTier: newPlan,
        amountCents,
        currency,
        paymentStatus: 'pending',
        // opcionalmente deja huella de upgrade:
        type: 'upgrade',
        updatedAt: now,
      }, { merge: true }),

      flatRef.set({
        tenantId,
        orderId,
        planTier: newPlan,
        desiredSubdomain: cur?.desiredSubdomain || tenantId,
        customer: cur?.customer || null,
        amountCents,
        currency,
        paymentStatus: 'pending',
        orderStatus: cur?.orderStatus || 'created',
        type: 'upgrade',
        updatedAt: new Date(),
      }, { merge: true }),
    ]);

    return json({ ok: true, tenantId, orderId, planTier: newPlan, amountCents, currency }, 200);
  } catch (e: any) {
    return json({ error: e?.message || 'Unexpected error' }, 500);
  }
}
