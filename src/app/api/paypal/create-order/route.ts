import { NextRequest, NextResponse } from 'next/server';
import { getPayPalAccessToken, getPayPalBase } from '../_paypal';
import { adminDb } from '@/lib/firebase/admin';

export const runtime = 'nodejs';

function j(d: any, s = 200) { return NextResponse.json(d, { status: s }); }
function toCents(n: unknown): number {
  if (typeof n === 'number') return Math.round(n * 100);
  if (typeof n === 'string') {
    const v = Number(n.replace(/[^\d.-]/g, ''));
    return Math.round(v * 100);
  }
  return 0;
}

async function resolveAmountCents(tenantId: string, orderId: string, provided?: number): Promise<{ cents: number; currency: string }> {
  // 1) si viene válido, úsalo (evita race conditions si cliente fuerza el monto)
  if (Number.isInteger(provided) && provided! >= 1) {
    return { cents: provided!, currency: (process.env.PAY_CURRENCY || 'USD').toUpperCase() };
  }

  // 2) fallback: lee la orden interna y calcula
  const ref = adminDb.doc(`tenants/${tenantId}/tenantOrders/${orderId}`);
  const snap = await ref.get();
  if (!snap.exists) throw new Error('Order not found to resolve amount');

  const data = snap.data() || {};
  // Ajusta a tus campos reales:
  let currency = (data.currency || process.env.PAY_CURRENCY || 'USD').toString().toUpperCase();

  let cents = 0;
  if (typeof data.total === 'number') {
    cents = Math.round(data.total * 100);
  } else if (typeof data.total === 'string') {
    cents = toCents(data.total);
  } else if (typeof data.amountCents === 'number') {
    cents = data.amountCents;
  } else {
    // ejemplo: suma subtotal + taxes - discounts si tu esquema lo tiene
    const subtotal = Number(data.subtotal || 0);
    const taxes    = Number(data.taxes || 0);
    const disc     = Number(data.discounts || 0);
    cents = Math.round((subtotal + taxes - disc) * 100);
  }

  if (!Number.isInteger(cents) || cents < 1) {
    throw new Error('Invalid order total when resolving amount');
  }
  return { cents, currency };
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as {
      tenantId?: string; orderId?: string; amountCents?: number; currency?: string; description?: string; selectedPlan?: string;
    };

    const tenantId = body.tenantId?.trim();
    const orderId  = body.orderId?.trim();
    if (!tenantId || !orderId) return j({ error: 'Missing tenantId or orderId' }, 400);

    // si client pasa amountCents lo usamos — evita race conditions
    const { cents, currency } = await resolveAmountCents(
      tenantId,
      orderId,
      typeof body.amountCents === 'number' ? Math.floor(body.amountCents) : undefined
    );

    // Logs defensivos para debug
    console.log('[paypal:create-order] resolved amount', {
      tenantId, orderId, cents, currency, provided: body.amountCents, selectedPlan: body.selectedPlan,
    });

    const value = (cents / 100).toFixed(2);
    const description = body.description || `Order ${orderId} @ ${tenantId}`;

    const accessToken = await getPayPalAccessToken();
    const base = getPayPalBase();

    const createResp = await fetch(`${base}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': `${tenantId}__${orderId}`,
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [{
          amount: { currency_code: currency, value },
          description,
          custom_id: `${tenantId}__${orderId}`,
        }],
        application_context: {
          brand_name: tenantId,
          shipping_preference: 'NO_SHIPPING',
          user_action: 'PAY_NOW',
        },
      }),
    });

    const json = await createResp.json().catch(() => ({}));
    if (!createResp.ok) {
      console.error('[paypal:create-order] create failed', { status: createResp.status, json });
      return j({ error: 'PayPal create failed', details: json }, 500);
    }

    const id = json?.id as string | undefined;
    if (!id) return j({ error: 'No PayPal order id' }, 500);

    // Respondemos metadata útil para el cliente
    return j({ paypalOrderId: id, id, orderId, amountCents: cents });
  } catch (e: any) {
    console.error('[paypal:create-order] exception', { message: e?.message });
    return j({ error: e?.message || 'Internal error' }, 500);
  }
}
