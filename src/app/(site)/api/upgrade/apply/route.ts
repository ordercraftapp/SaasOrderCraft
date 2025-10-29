// src/app/(site)/api/upgrade/apply
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { adminDb, adminAuth } from '@/lib/firebase/admin';
import { Timestamp } from 'firebase-admin/firestore';
import { normalizeTenantId, assertValidTenantId } from '@/lib/tenant/validate';

// 🔗 Usa tu mapa centralizado de features
import { PLAN_FEATURES } from '@/lib/plans/features';
import type { FeatureKey } from '@/lib/plans/types';

// ✉️ Envío de email
import { sendTransactionalEmail } from '@/lib/email/brevoTx';

type PlanId = 'starter' | 'pro' | 'full';

function json(d: unknown, s = 200) {
  return NextResponse.json(d, { status: s });
}

function buildSiteSuccessUrl(tenantId: string, orderId: string) {
  return `/success?tenantId=${encodeURIComponent(tenantId)}&orderId=${encodeURIComponent(orderId)}`;
}

/** =========================
 * Helpers de formato / email
 * ========================= */

const PLAN_PRICE_CENTS: Record<PlanId, number> = {
  starter: 1999,
  pro: 2999,
  full: 3499,
};

function fmtMoney(cents: number, currency: string) {
  const v = (Number(cents) || 0) / 100;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(v);
  } catch {
    return `${v.toFixed(2)} ${currency}`;
  }
}

/** 🔗 URL de login del tenant (re-uso del patrón que tienes) */
function buildLoginUrl(tenantId: string) {
  const baseDomain = (process.env.NEXT_PUBLIC_BASE_DOMAIN || 'datacraftcoders.cloud').toLowerCase();
  const supportsWildcard = process.env.NEXT_PUBLIC_USE_WILDCARD_SUBDOMAINS?.toLowerCase() !== 'false';
  return supportsWildcard ? `https://${tenantId}.${baseDomain}/app/login` : `/${tenantId}/app/login`;
}

/** HTML para correo de confirmación de upgrade */
function upgradeHtml(params: {
  tenantId: string;
  adminName: string;
  plan: PlanId;
  priceLabel: string;
}) {
  const { tenantId, adminName, plan, priceLabel } = params;
  const loginUrl = buildLoginUrl(tenantId);
  const safeName = (adminName || '').trim();

  return `
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#fff;opacity:0;">
    Your plan has been upgraded successfully!
  </div>
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f6f8fb;padding:40px 0;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="background:#fff;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,0.05);padding:40px;">
          <tr>
            <td align="center" style="font-family:Arial,Helvetica,sans-serif;">
              <h1 style="font-size:22px;margin-bottom:8px;color:#111827;">Plan upgraded successfully 🎉</h1>
              <p style="font-size:15px;color:#374151;margin:0 0 16px 0;">
                Hi ${safeName || 'there'}, your workspace <strong>${tenantId}</strong> has been upgraded to the <strong>${plan.charAt(0).toUpperCase()+plan.slice(1)}</strong> plan.
              </p>
              <p style="font-size:15px;color:#374151;margin:0 0 16px 0;">
                Your new monthly price is <strong>${priceLabel}</strong>.
              </p>
              <a href="${loginUrl}" style="display:inline-block;background:#2563eb;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;font-weight:600;margin-top:10px;">
                Go to Dashboard
              </a>
              <p style="margin-top:24px;font-size:13px;color:#6b7280;">If you didn’t request this upgrade, please contact support.</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>`;
}

/** Texto plano para correo */
function upgradeText(params: { tenantId: string; plan: PlanId; priceLabel: string }) {
  const loginUrl = buildLoginUrl(params.tenantId);
  return `Your workspace ${params.tenantId} has been upgraded to ${params.plan.toUpperCase()}.
New monthly price: ${params.priceLabel}

Open your dashboard: ${loginUrl}

If you didn't request this upgrade, contact support.`;
}

/** =========================
 *  POST: aplica el upgrade (ya existente) — ahora con email
 *  ========================= */
export async function POST(req: NextRequest) {
  try {
    const { tenantId: rawTenant, orderId } = await req.json() as { tenantId?: string; orderId?: string };
    const tenantId = normalizeTenantId(String(rawTenant || ''));
    if (!tenantId || !orderId) return json({ error: 'Missing params' }, 400);
    assertValidTenantId(tenantId);

    const tRef = adminDb.doc(`tenants/${tenantId}`);
    const oRef = adminDb.doc(`tenants/${tenantId}/tenantOrders/${orderId}`);

    const [tSnap, oSnap] = await Promise.all([tRef.get(), oRef.get()]);
    if (!tSnap.exists || !oSnap.exists) return json({ error: 'Not found' }, 404);

    const tenant = tSnap.data() as any;
    const order  = oSnap.data() as any;

    if (order?.paymentStatus !== 'paid') {
      return json({ error: 'Order is not paid' }, 409);
    }

    const planTier: PlanId = (order?.planTier === 'pro' || order?.planTier === 'full') ? order.planTier : 'starter';
    const features: FeatureKey[] = PLAN_FEATURES[planTier] || [];

    // construimos también un map de features { key: true } para compatibilidad/consumo rápido
    const featuresMap: Record<string, boolean> = {};
    for (const k of features) featuresMap[k] = true;

    const now = Timestamp.now();

    await adminDb.runTransaction(async (trx) => {
      const t = await trx.get(tRef);
      const o = await trx.get(oRef);
      if (!t.exists || !o.exists) throw new Error('Not found');

      // --- Actualizamos tenant: planTier + features (array) + featuresMap + marca active + timestamp ---
      trx.update(tRef, {
        planTier,
        features,      // conservamos la representación en array (compatible con tu ejemplo Firestore)
        featuresMap,   // adición: mapa explícito para checks rápidos
        status: 'active',
        updatedAt: now,
      });

      // --- Actualizamos la orden a provisioned (idempotente si ya lo está) ---
      trx.update(oRef, {
        orderStatus: 'provisioned',
        updatedAt: now,
      });

      // Ajustar límites de marketing según plan (tu lógica existente)
      const maxByPlan = planTier === 'pro' ? 10 : planTier === 'full' ? 20 : 5;
      trx.set(
        adminDb.doc(`tenants/${tenantId}/system_flags/marketing`),
        { tenantId, maxCampaignsPerMonth: maxByPlan, updatedAt: now },
        { merge: true },
      );

      // --- Escribir también un resumen en system_flags/plan para consultas centralizadas ---
      trx.set(
        adminDb.doc(`tenants/${tenantId}/system_flags/plan`),
        {
          tenantId,
          planTier,
          features,
          updatedAt: now,
        },
        { merge: true },
      );
    });

    // Optional: refrescar custom claims si tienes dueño con uid (no bloqueante)
    try {
      const ownerUid = (tenant?.owner?.uid || '').toString().trim();
      if (ownerUid) {
        const rec = await adminAuth.getUser(ownerUid);
        const claims = (rec.customClaims as any) || {};
        await adminAuth.setCustomUserClaims(ownerUid, { ...claims }); // no cambiamos roles aquí
      }
    } catch (e) {
      console.error('[upgrade/apply] setCustomUserClaims noop error:', e);
    }

    // -----------------------
    // Envío de correo de confirmación del upgrade (no bloqueante en términos de DB correctness)
    // -----------------------
    try {
      // Preferimos info del tenant.owner pero fallback a order.customer
      const adminEmail = ((tenant?.owner?.email as string) || (order?.customer?.email as string) || '').trim().toLowerCase();
      const adminName = (tenant?.owner?.name || order?.customer?.name || '').trim();

      if (adminEmail) {
        // priceLabel: preferir amountCents desde la orden; fallback al price por plan
        const amountCents = Number(order?.amountCents ?? PLAN_PRICE_CENTS[planTier]) || PLAN_PRICE_CENTS[planTier];
        const currency = (order?.currency || 'USD').toUpperCase();
        const priceLabel = `${fmtMoney(amountCents, currency)} / month`;

        const html = upgradeHtml({
          tenantId,
          adminName,
          plan: planTier,
          priceLabel,
        });

        const text = upgradeText({ tenantId, plan: planTier, priceLabel });

        // Usas el mismo shape que en tu otro endpoint: toEmail, toName, subject, html, text
        await sendTransactionalEmail({
          toEmail: adminEmail,
          toName: adminName || '',
          subject: `Your workspace "${tenantId}" was upgraded to ${planTier.toUpperCase()}`,
          html,
          text,
        });
        console.log(`[upgrade/apply] upgrade email sent to ${adminEmail} for ${tenantId} -> ${planTier}`);
      } else {
        console.warn('[upgrade/apply] no admin email available to send upgrade confirmation');
      }
    } catch (e) {
      // No queremos fallar el endpoint si el email falla; solo logueamos
      console.error('[upgrade/apply] upgrade confirmation email failed:', e);
    }

    const successUrl = buildSiteSuccessUrl(tenantId, orderId);
    return json({ ok: true, tenantId, orderId, planTier, successUrl }, 200);
  } catch (e: any) {
    console.error('[upgrade/apply] exception', e);
    return json({ error: e?.message || 'Unexpected error' }, 500);
  }
}
