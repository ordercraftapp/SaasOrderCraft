import { NextRequest, NextResponse } from 'next/server';
import { getPayPalAccessToken, getPayPalBase } from '../_paypal';

export const runtime = 'nodejs';

type CreateBody = {
  tenantId?: string;
  orderId?: string;
  amountCents?: number; // opcional si ya lo calculaste; si no, pásalo desde tu upgrade API
  currency?: string;    // 'USD' por defecto
  description?: string; // opcional
};

function j(d: any, s = 200) { return NextResponse.json(d, { status: s }); }

export async function POST(req: NextRequest) {
  try {
    const body = await req.json() as CreateBody;
    const { tenantId, orderId } = body;
    const amountCents = Number(body.amountCents ?? 0);
    const currency = (body.currency || process.env.PAY_CURRENCY || 'USD').toUpperCase();
    const description = body.description || `Order ${orderId} @ ${tenantId}`;

    // Logs defensivos (no secretos)
    console.log('[paypal:create-order] start', {
      tenantId, orderId,
      amountCents, currency,
      env: process.env.PAYPAL_ENV || 'sandbox',
      server_id_present: Boolean(process.env.PAYPAL_CLIENT_ID),
      server_secret_present: Boolean(process.env.PAYPAL_CLIENT_SECRET),
    });

    if (!tenantId || !orderId) return j({ error: 'Missing tenantId or orderId' }, 400);
    if (!amountCents || amountCents < 1) return j({ error: 'Invalid amountCents' }, 400);

    // PayPal total en decimales
    const value = (amountCents / 100).toFixed(2);

    const accessToken = await getPayPalAccessToken();
    const base = getPayPalBase();

    const createResp = await fetch(`${base}/v2/checkout/orders`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'PayPal-Request-Id': `${tenantId}__${orderId}`, // idempotencia
      },
      body: JSON.stringify({
        intent: 'CAPTURE',
        purchase_units: [
          {
            amount: { currency_code: currency, value },
            description,
            custom_id: `${tenantId}__${orderId}`,
          }
        ],
        application_context: {
          brand_name: tenantId,
          shipping_preference: 'NO_SHIPPING',
          user_action: 'PAY_NOW',
          return_url: 'https://www.datacraftcoders.cloud/checkout/success', // opcionales
          cancel_url: 'https://www.datacraftcoders.cloud/checkout/cancel',
        },
      }),
    });

    const createJson = await createResp.json().catch(() => ({}));
    if (!createResp.ok) {
      console.error('[paypal:create-order] create failed', {
        status: createResp.status,
        bodyKeys: Object.keys(createJson || {}),
      });
      return j({ error: 'PayPal create failed', details: createJson }, 500);
    }

    const id = createJson?.id as string | undefined;
    if (!id) {
      console.error('[paypal:create-order] no id in response');
      return j({ error: 'No PayPal order id' }, 500);
    }

    console.log('[paypal:create-order] success', { id });
    return j({ id });
  } catch (e: any) {
    console.error('[paypal:create-order] exception', { message: e?.message });
    const msg = e?.message?.includes('Missing PAYPAL_CLIENT_ID') || e?.message?.includes('PAYPAL_CLIENT_SECRET')
      ? 'Missing PAYPAL_CLIENT_ID or PAYPAL_CLIENT_SECRET'
      : (e?.message || 'Internal error');
    return j({ error: msg }, 500);
  }
}
