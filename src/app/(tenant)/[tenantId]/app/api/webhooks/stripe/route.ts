// src/app/(tenant)/[tenant]/app/api/webhooks/stripe/route.ts
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import Stripe from 'stripe';

// ✅ Tenant helpers
import { resolveTenantFromRequest, requireTenantId } from '@/lib/tenant/server';

// ✅ Firestore (Admin) tenant-aware
import { tColAdmin } from '@/lib/db_admin';
import { FieldValue } from 'firebase-admin/firestore';

export async function POST(
  req: NextRequest,
  ctx: { params: { tenant: string } }
) {
  // ✅ asegura que existan las env vars
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  const stripeSecret = process.env.STRIPE_SECRET_KEY;
  if (!webhookSecret || !stripeSecret) {
    return NextResponse.json(
      { error: 'Missing STRIPE_WEBHOOK_SECRET or STRIPE_SECRET_KEY' },
      { status: 500 }
    );
  }

  // 🔐 Tenant desde la ruta/subdominio
  const tenantId = requireTenantId(
    resolveTenantFromRequest(req, ctx?.params),
    'api:/webhooks/stripe'
  );

  // ✅ Stripe SDK en runtime Node con apiVersion tipada
  const stripe = new Stripe(stripeSecret, {
    apiVersion: '2024-06-20' as Stripe.LatestApiVersion,
  });

  // ⚠️ obtener raw body para verificar firma
  let event: Stripe.Event;
  try {
    const body = Buffer.from(await req.arrayBuffer());
    const signature = req.headers.get('stripe-signature') ?? '';
    event = stripe.webhooks.constructEvent(body, signature, webhookSecret);
  } catch (err: any) {
    console.error('[stripe webhook] signature error:', err?.message);
    return NextResponse.json({ error: 'Invalid signature' }, { status: 400 });
  }

  try {
    if (event.type === 'payment_intent.succeeded') {
      const pi = event.data.object as Stripe.PaymentIntent;
      const draftId = (pi.metadata as any)?.draftId;
      if (!draftId) return NextResponse.json({ ok: true });

      // Draft bajo el tenant
      const draftRef = tColAdmin('orderDrafts', tenantId).doc(String(draftId));
      const snap = await draftRef.get();
      if (!snap.exists) return NextResponse.json({ ok: true });

      const d = (snap.data() as any) || {};
      if (d.status === 'completed') return NextResponse.json({ ok: true }); // idempotente

      const payload = d.payload || {};
      const currency =
        payload?.totals?.currency ||
        payload?.currency ||
        'GTQ';
      const amount =
        payload?.orderTotal ??
        payload?.totals?.grandTotalWithTax ??
        payload?.totals?.grandTotal ??
        0;

      // Crear orden bajo tenants/{tenantId}/orders
      const orderRef = await tColAdmin('orders', tenantId).add({
        ...payload,
        tenantId, // ✅ refuerzo de scope
        payment: {
          provider: 'stripe',
          status: 'succeeded',
          amount,
          currency,
          intentId: pi.id,
          createdAt: FieldValue.serverTimestamp(),
        },
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        source: 'webhook/stripe',
      });

      // Marcar draft como completado
      await draftRef.update({
        tenantId,
        status: 'completed',
        orderId: orderRef.id,
        completedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      // (Opcional) Auditoría
      // await tColAdmin('_admin_audit', tenantId).add({
      //   type: 'stripe_payment_succeeded',
      //   tenantId,
      //   draftId,
      //   orderId: orderRef.id,
      //   intentId: pi.id,
      //   at: FieldValue.serverTimestamp(),
      // });
    }

    if (event.type === 'payment_intent.payment_failed') {
      const pi = event.data.object as Stripe.PaymentIntent;
      const draftId = (pi.metadata as any)?.draftId;
      if (draftId) {
        await tColAdmin('orderDrafts', tenantId).doc(String(draftId)).set(
          {
            tenantId,
            status: 'failed',
            updatedAt: FieldValue.serverTimestamp(),
            failure: {
              code: (pi.last_payment_error as any)?.code || null,
              message: (pi.last_payment_error as any)?.message || null,
            },
          },
          { merge: true }
        );

        // (Opcional) Auditoría
        // await tColAdmin('_admin_audit', tenantId).add({
        //   type: 'stripe_payment_failed',
        //   tenantId,
        //   draftId,
        //   intentId: pi.id,
        //   at: FieldValue.serverTimestamp(),
        // });
      }
    }

    return NextResponse.json({ ok: true });
  } catch (e: any) {
    console.error('[stripe webhook] handler error:', e);
    try {
      // Audit de error por tenant
      await tColAdmin('_admin_audit', tenantId).add({
        type: 'stripe_webhook_error',
        tenantId,
        error: String(e?.message || e),
        at: FieldValue.serverTimestamp(),
      });
    } catch { /* no-op */ }
    return NextResponse.json({ error: e?.message || 'Error' }, { status: 500 });
  }
}

// (Opcional) verificación rápida del endpoint
export async function GET() {
  return NextResponse.json({ ok: true });
}
