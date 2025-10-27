// src/app/api/paypal/capture/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getPayPalAccessToken, getPayPalBase } from '../_paypal';
import { adminDb } from '@/lib/firebase/admin';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const { tenantId, orderId, paypalOrderId } = await req.json() as {
      tenantId?: string; orderId?: string; paypalOrderId?: string;
    };
    if (!tenantId || !orderId || !paypalOrderId) {
      return NextResponse.json({ error: 'Missing tenantId, orderId or paypalOrderId' }, { status: 400 });
    }

    const docRef = adminDb.doc(`tenants/${tenantId}/tenantOrders/${orderId}`);
    const snap = await docRef.get();
    if (!snap.exists) return NextResponse.json({ error: 'Order not found' }, { status: 404 });

    const data = snap.data()!;
    const alreadyPaid = data.paymentStatus === 'paid';
    const recordedPaypalId = data?.paypal?.orderId;

    // Idempotencia básica
    if (alreadyPaid && recordedPaypalId === paypalOrderId) {
      return NextResponse.json({ ok: true, status: 'already-paid' }, { status: 200 });
    }

    const accessToken = await getPayPalAccessToken();
    const base = getPayPalBase();

    // 1) Capturar
    const capResp = await fetch(`${base}/v2/checkout/orders/${paypalOrderId}/capture`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': `${tenantId}__${orderId}`, // idempotencia extra
      },
    });
    const capJson = await capResp.json();
    if (!capResp.ok) {
      return NextResponse.json({ error: 'PayPal capture failed', details: capJson }, { status: 500 });
    }

    const captureId = capJson?.purchase_units?.[0]?.payments?.captures?.[0]?.id;
    const status = capJson?.status;

    // 2) Actualizar orden interna
    await docRef.set({
      paymentStatus: 'paid',
      paidAt: new Date(),
      paypal: {
        ...(data.paypal || {}),
        orderId: paypalOrderId,
        captureId,
        status,
        payload: capJson,
      },
      updatedAt: new Date(),
    }, { merge: true });

    return NextResponse.json({ ok: true, captureId, status }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Internal error' }, { status: 500 });
  }
}
