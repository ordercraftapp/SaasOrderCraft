// src/app/api/pay/stripe/create-intent/route.ts
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import * as admin from 'firebase-admin';
import Stripe from 'stripe';

function getAdmin() {
  if (!admin.apps.length) {
    admin.initializeApp({ credential: admin.credential.applicationDefault() });
  }
  return admin;
}

function toCents(n: number) {
  return Math.round(Number(n || 0) * 100);
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const orderDraft = body?.orderDraft;
    if (!orderDraft) {
      return NextResponse.json({ error: 'Missing orderDraft' }, { status: 400 });
    }

    const secret = process.env.STRIPE_SECRET_KEY;
    if (!secret) {
      return NextResponse.json({ error: 'Stripe no configurado (STRIPE_SECRET_KEY)' }, { status: 500 });
    }

    // ✅ Tipado compatible con tu SDK
    const stripe = new Stripe(secret, {
      apiVersion: '2024-06-20' as Stripe.LatestApiVersion,
    });

    const currency =
      (orderDraft?.totals?.currency || process.env.PAY_CURRENCY || 'GTQ').toLowerCase();
    const amountCents = toCents(orderDraft?.orderTotal || 0);

    // 1) Guardar borrador
    const db = getAdmin().firestore();
    const draftRef = await db.collection('orderDrafts').add({
      status: 'pending',
      provider: 'stripe',
      currency: currency.toUpperCase(),
      amount: orderDraft.orderTotal,
      payload: orderDraft,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // 2) Crear PaymentIntent
    const intent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency,
      metadata: { draftId: draftRef.id },
      automatic_payment_methods: { enabled: true },
    });

    // 3) Guardar referencia y responder
    await draftRef.update({ stripeIntentId: intent.id });

    return NextResponse.json({ clientSecret: intent.client_secret }, { status: 200 });
  } catch (e: any) {
    console.error('[stripe/create-intent] error:', e);
    return NextResponse.json({ error: e?.message || 'Error' }, { status: 500 });
  }
}
