// src/app/api/paypal/create-order/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getPayPalAccessToken, getPayPalBase } from '../_paypal';
import { adminDb } from '@/lib/firebase/admin'; // mismo patrón que usas en /api/tenant-order

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const { tenantId, orderId } = await req.json() as { tenantId?: string; orderId?: string };
    if (!tenantId || !orderId) {
      return NextResponse.json({ error: 'Missing tenantId or orderId' }, { status: 400 });
    }

    // 1) Cargar la orden interna
    const docRef = adminDb.doc(`tenants/${tenantId}/tenantOrders/${orderId}`);
    const snap = await docRef.get();
    if (!snap.exists) {
      return NextResponse.json({ error: 'Order not found' }, { status: 404 });
    }
    const data = snap.data()!;
    const amountCents = data.amountCents ?? 0;
    const currency = (data.currency || 'USD').toUpperCase();

    if (amountCents <= 0) {
      return NextResponse.json({ error: 'Invalid amount' }, { status: 400 });
    }

    // 2) Crear PayPal order
    const accessToken = await getPayPalAccessToken();
    const base = getPayPalBase();

    const body = {
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: `${tenantId}__${orderId}`,
          amount: {
            currency_code: currency,
            value: (amountCents / 100).toFixed(2),
          },
        },
      ],
      application_context: {
        shipping_preference: 'NO_SHIPPING',
        user_action: 'PAY_NOW',
      },
    };

    const resp = await fetch(`${base}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const json = await resp.json();
    if (!resp.ok) {
      return NextResponse.json({ error: 'PayPal create failed', details: json }, { status: 500 });
    }

    // 3) Guardar referencia en la orden interna (opcional)
    await docRef.set({
      paypal: {
        orderId: json.id,
        status: json.status,
        createdAt: new Date().toISOString(),
      },
      updatedAt: new Date(),
    }, { merge: true });

    return NextResponse.json({ paypalOrderId: json.id }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Internal error' }, { status: 500 });
  }
}
