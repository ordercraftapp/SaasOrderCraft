// src/app/api/upgrade/use-existing-order/route.ts
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
    const { tenantId: rawTenant, orderId: rawOrderId, newPlan } = await req.json() as {
      tenantId?: string; orderId?: string; newPlan?: PlanId;
    };

    const tenantId = normalizeTenantId(String(rawTenant || ''));
    const orderId  = String(rawOrderId || '').trim();
    if (!tenantId || !orderId || !newPlan) return json({ error: 'Missing tenantId, orderId or newPlan' }, 400);
    assertValidTenantId(tenantId);
    if (!['starter', 'pro', 'full'].includes(newPlan)) return json({ error: 'Invalid plan' }, 400);

    const amountCents = PLAN_PRICE_CENTS[newPlan];
    const currency = 'USD';
    const now = Timestamp.now();

    const tOrderRef = adminDb.doc(`tenants/${tenantId}/tenantOrders/${orderId}`);
    const mirrorId = `${tenantId}__${orderId}`;
    const flatRef = adminDb.collection('tenantOrders').doc(mirrorId);

    // Usamos transacción para leer el estado actual y decidir actualizar o crear nueva orden
    const result = await adminDb.runTransaction(async (tx) => {
      const snap = await tx.get(tOrderRef);
      if (!snap.exists) {
        throw new Error('Order not found');
      }
      const cur = snap.data() || {};

      // Si la orden actual ya está pagada/provisionada, creamos una nueva orden "upgrade"
      const alreadyPaid = (String(cur.paymentStatus || '').toLowerCase() === 'paid') ||
                          (String(cur.orderStatus || '').toLowerCase() === 'provisioned');

      if (alreadyPaid) {
        // Generamos newOrderId único (timestamp basado)
        const newOrderId = `${orderId}__upgrade__${now.toMillis()}`;
        const newTOrderRef = adminDb.doc(`tenants/${tenantId}/tenantOrders/${newOrderId}`);
        const newFlatRefId = `${tenantId}__${newOrderId}`;
        const newFlatRef = adminDb.collection('tenantOrders').doc(newFlatRefId);

        const newDoc = {
          tenantId,
          orderId: newOrderId,
          planTier: newPlan,
          desiredSubdomain: cur?.desiredSubdomain || tenantId,
          customer: cur?.customer || null,
          amountCents,
          currency,
          paymentStatus: 'pending',
          orderStatus: 'created',
          type: 'upgrade',
          createdAt: now,
          updatedAt: now,
          sourceOrderId: orderId, // referencia a la orden origen
        };

        tx.set(newTOrderRef, newDoc, { merge: true });
        tx.set(newFlatRef, newDoc, { merge: true });

        return { effectiveOrderId: newOrderId, amountCents, currency, createdNew: true };
      } else {
        // Actualizamos la misma orden (merge) — el tx.set aquí garantiza que la escritura se confirme
        const updates = {
          planTier: newPlan,
          amountCents,
          currency,
          paymentStatus: 'pending',
          type: 'upgrade',
          updatedAt: now,
        };

        tx.set(tOrderRef, updates, { merge: true });
        tx.set(flatRef, {
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
          updatedAt: now,
        }, { merge: true });

        return { effectiveOrderId: orderId, amountCents, currency, createdNew: false };
      }
    });

    // Log para depuración
    console.log('[use-existing-order] result', { tenantId, originalOrderId: orderId, ...result });

    return json({
      ok: true,
      tenantId,
      orderId: result.effectiveOrderId,
      planTier: newPlan,
      amountCents: result.amountCents,
      currency: result.currency,
      createdNew: result.createdNew,
    }, 200);
  } catch (e: any) {
    console.error('[use-existing-order] exception', e);
    return json({ error: e?.message || 'Unexpected error' }, 500);
  }
}
