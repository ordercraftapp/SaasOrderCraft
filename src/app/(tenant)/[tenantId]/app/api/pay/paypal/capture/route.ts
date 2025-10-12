// src/app/(tenant)/[tenant]/app/api/pay/paypal/capture/route.ts
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';

// ✅ Tenant/Scope helpers
// TenantUpdate: resolvemos tenant desde request + params y exigimos que exista
import { resolveTenantFromRequest, requireTenantId } from '@/lib/tenant/server';

// ✅ Firestore Admin (helpers tenant-aware)
import { tColAdmin } from '@/lib/db_admin';
import { FieldValue } from "firebase-admin/firestore";


/** ===== PayPal helpers (sin cambios funcionales) ===== */
async function getPaypalAccessToken() {
  const cid = process.env.PAYPAL_CLIENT_ID!;
  const sec = process.env.PAYPAL_CLIENT_SECRET!;
  const isLive = process.env.PAYPAL_ENV === 'live';
  const base = isLive ? 'https://api.paypal.com' : 'https://api.sandbox.paypal.com';
  const authRes = await fetch(`${base}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${cid}:${sec}`).toString('base64'),
    },
    body: 'grant_type=client_credentials',
    cache: 'no-store',
  });
  if (!authRes.ok) throw new Error('PayPal auth failed');
  const j = (await authRes.json()) as any;
  return j.access_token as string;
}

export async function POST(
  req: NextRequest,
  ctx: { params: { tenant: string } }
) {
  try {
    // TenantUpdate: resolver + requerir tenantId desde subdominio o segmento
    const tenantId = requireTenantId(
      resolveTenantFromRequest(req, ctx?.params),
      'api:/pay/paypal/capture'
    );

    const { paypalOrderId } = await req.json().catch(() => ({}));
    if (!paypalOrderId) {
      return NextResponse.json({ error: 'Missing paypalOrderId' }, { status: 400 });
    }

    const token = await getPaypalAccessToken();
    const isLive = process.env.PAYPAL_ENV === 'live';
    const base = isLive ? 'https://api.paypal.com' : 'https://api.sandbox.paypal.com';

    // === Capturar en PayPal ===
    const capRes = await fetch(`${base}/v2/checkout/orders/${paypalOrderId}/capture`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      cache: 'no-store',
      body: JSON.stringify({}),
    });

    if (!capRes.ok) {
      const t = await capRes.text();
      throw new Error(`PayPal capture failed: ${t}`);
    }

    const data = await capRes.json();

    // === Buscar draft por paypalOrderId en el scope del tenant ===
    const draftsSnap = await tColAdmin('orderDrafts', tenantId)
      .where('paypalOrderId', '==', paypalOrderId)
      .limit(1)
      .get();

    const draftSnap = draftsSnap.docs[0];
    if (!draftSnap?.exists) {
      // AuditUpdate: registramos intento sin draft
      await tColAdmin('_admin_audit', tenantId).add({
        type: 'paypal_capture_no_draft',
        tenantId,
        paypalOrderId,
        payload: { paypal: data },
        at: FieldValue.serverTimestamp(),
      });
      return NextResponse.json({ ok: true, note: 'draft not found' });
    }

    const draft = draftSnap.data() || {};
    if (draft.status === 'completed' && draft.orderId) {
      // Idempotente
      return NextResponse.json({ ok: true, orderId: draft.orderId });
    }

    // === Crear order bajo tenants/{tenantId}/orders ===
    const payload = draft.payload || {};
    const currency =
      payload?.totals?.currency ||
      payload?.currency ||
      'GTQ';

    const amount =
      payload?.orderTotal ??
      payload?.totals?.grandTotalWithTax ??
      payload?.totals?.grandTotal ??
      0;

    const orderRef = await tColAdmin('orders', tenantId).add({
      ...payload,
      tenantId, // TenantUpdate: siempre escribir tenantId
      payment: {
        provider: 'paypal',
        status: 'succeeded',
        amount,
        currency,
        paypalOrderId,
        createdAt: FieldValue.serverTimestamp(),
      },
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      source: 'api/paypal/capture',
    });

    // === Marcar draft como completado dentro del tenant ===
    await draftSnap.ref.update({
      status: 'completed',
      completedAt: FieldValue.serverTimestamp(),
      orderId: orderRef.id,
      tenantId, // TenantUpdate: reforzar scope
    });

    // AuditUpdate: registrar captura exitosa
    await tColAdmin('_admin_audit', tenantId).add({
      type: 'paypal_capture_ok',
      tenantId,
      paypalOrderId,
      orderId: orderRef.id,
      at: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ ok: true, orderId: orderRef.id }, { status: 200 });
  } catch (e: any) {
    console.error('[paypal/capture] error:', e);
    try {
      // AuditUpdate: registrar error por tenant si alcanzamos a resolverlo
      const tenantId = resolveTenantFromRequest(req, ctx?.params) || 'unknown';
      await tColAdmin('_admin_audit', tenantId).add({
        type: 'paypal_capture_error',
        tenantId,
        error: String(e?.message || e),
        at: FieldValue.serverTimestamp(),
      });
    } catch {
      // si falla la auditoría, no bloquear la respuesta
    }
    return NextResponse.json({ error: e?.message || 'Error' }, { status: 500 });
  }
}
