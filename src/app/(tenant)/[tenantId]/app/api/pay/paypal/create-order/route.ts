// src/app/(tenant)/[tenant]/app/pay/paypal/create-order/route.ts
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getTenantPaypalAccessToken, getTenantPaypalPublic } from '@/lib/payments/paypal';
// ✅ Tenant helpers (segmento/subdominio → tenantId)
import { resolveTenantFromRequest, requireTenantId } from '@/lib/tenant/server';

// ✅ Firestore Admin helpers (tenant-aware)
import { tColAdmin } from '@/lib/db_admin';
import { FieldValue } from 'firebase-admin/firestore';

/** ===== PayPal helpers (api-m recomendado) ===== */
async function getPaypalAccessToken() {
  const cid = process.env.PAYPAL_CLIENT_ID!;
  const sec = process.env.PAYPAL_CLIENT_SECRET!;
  const isLive = process.env.PAYPAL_ENV === 'live';
  const base = isLive ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';

  const res = await fetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${cid}:${sec}`).toString('base64'),
    },
    body: 'grant_type=client_credentials',
    cache: 'no-store',
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`PayPal auth failed: ${res.status} ${res.statusText} ${txt}`);
  }
  const j = (await res.json()) as any;
  return j.access_token as string;
}

export async function POST(
  req: NextRequest,
  ctx: { params: { tenant: string } }
) {
  // ⚠️ Nota: no hacemos trabajo en background; todo dentro de esta respuesta
  try {
    // ✅ Resolver tenantId (obligatorio)
    const tenantId = requireTenantId(
      resolveTenantFromRequest(req, ctx?.params),
      'api:/pay/paypal/create-order'
    );

    const body = await req.json().catch(() => ({}));
    const orderDraft = body?.orderDraft;
    if (!orderDraft) {
      return NextResponse.json({ error: 'Missing orderDraft' }, { status: 400 });
    }

    // ✅ Normalizar moneda y montos
    const pub = await getTenantPaypalPublic(tenantId);
if (!pub?.enabled) {
  return NextResponse.json({ error: 'PayPal disabled for this tenant' }, { status: 400 });
}

const currency = String(
  orderDraft?.totals?.currency || pub.currency || 'GTQ'
).toUpperCase();

const amountValue = Number(orderDraft?.orderTotal || 0);
const amountStr = amountValue.toFixed(2);

    // ✅ Token + endpoint api-m
    const { token, base } = await getTenantPaypalAccessToken(tenantId, 'api-m');  
    const isLive = process.env.PAYPAL_ENV === 'live';   

    // ====== Guardar draft (tenant-scoped) ======
    const draftRef = await tColAdmin('orderDrafts', tenantId).add({
      tenantId,                  // 👈 siempre grabar tenantId
      status: 'pending',
      provider: 'paypal',
      currency,
      amount: amountValue,       // numérico para nuestros reportes
      payload: orderDraft,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });

    // ====== Crear PayPal Order ======
    const resp = await fetch(`${base}/v2/checkout/orders`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  cache: 'no-store',
  body: JSON.stringify({
    intent: 'CAPTURE',
    purchase_units: [{ amount: { currency_code: currency, value: amountStr } }],
    application_context: { shipping_preference: 'NO_SHIPPING' },
  }),
});

    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      // Auditar fallo y actualizar draft
      await Promise.all([
        draftRef.update({
          status: 'failed',
          failureReason: `create_failed: ${t}`,
          updatedAt: FieldValue.serverTimestamp(),
        }),
        tColAdmin('_admin_audit', tenantId).add({
          type: 'paypal_create_failed',
          tenantId,
          draftId: draftRef.id,
          details: String(t).slice(0, 2000),
          at: FieldValue.serverTimestamp(),
        }),
      ]);
      throw new Error(`PayPal create failed: ${t}`);
    }

    const data = await resp.json();
    const paypalOrderId = data?.id as string;

    // ✅ Actualizar draft con paypalOrderId y status
    await Promise.all([
      draftRef.update({
        status: 'created',
        paypalOrderId,
        updatedAt: FieldValue.serverTimestamp(),
      }),
      tColAdmin('_admin_audit', tenantId).add({
        type: 'paypal_create_ok',
        tenantId,
        draftId: draftRef.id,
        paypalOrderId,
        at: FieldValue.serverTimestamp(),
      }),
    ]);

    // Respuesta minimal para el cliente
    return NextResponse.json(
      { paypalOrderId, draftId: draftRef.id },
      { status: 200 }
    );
  } catch (e: any) {
    console.error('[paypal/create-order] error:', e);
    try {
      // Si podemos inferir tenant, registramos auditoría del error
      const tenantId = resolveTenantFromRequest(req, ctx?.params) || 'unknown';
      await tColAdmin('_admin_audit', tenantId).add({
        type: 'paypal_create_error',
        tenantId,
        error: String(e?.message || e),
        at: FieldValue.serverTimestamp(),
      });
    } catch {
      /* no-op si falla la auditoría */
    }
    return NextResponse.json({ error: e?.message || 'Error' }, { status: 500 });
  }
}
