// src/app/(site)/api/upgrade/apply
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { adminDb, adminAuth } from '@/lib/firebase/admin';
import { Timestamp } from 'firebase-admin/firestore';
import { normalizeTenantId, assertValidTenantId } from '@/lib/tenant/validate';

// 🔗 Usa tu mapa centralizado de features
import { PLAN_FEATURES } from '@/lib/plans/features';
import type { FeatureKey } from '@/lib/plans/types';

type PlanId = 'starter' | 'pro' | 'full';

function json(d: unknown, s = 200) {
  return NextResponse.json(d, { status: s });
}

function buildSiteSuccessUrl(tenantId: string, orderId: string) {
  return `/success?tenantId=${encodeURIComponent(tenantId)}&orderId=${encodeURIComponent(orderId)}`;
}

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

    const successUrl = buildSiteSuccessUrl(tenantId, orderId);
    return json({ ok: true, tenantId, orderId, planTier, successUrl }, 200);
  } catch (e: any) {
    console.error('[upgrade/apply] exception', e);
    return json({ error: e?.message || 'Unexpected error' }, 500);
  }
}
