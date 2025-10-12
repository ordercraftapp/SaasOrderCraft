// src/app/(site)/api/provision-tenant/route.ts
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { Timestamp } from 'firebase-admin/firestore';
import { normalizeTenantId, assertValidTenantId } from '@/lib/tenant/validate';
// 🔐 Auth (opcional). Habilita CREATE_OWNER_USER=true si quieres crear el usuario owner.
import { getAuth } from 'firebase-admin/auth';

// 🔗 Mapa centralizado de features por plan
import { PLAN_FEATURES } from '@/lib/plans/features';
import type { PlanTier as PlanId, FeatureKey } from '@/lib/plans/types';

function json(d: unknown, s = 200) {
  return NextResponse.json(d, { status: s });
}

// Cambia a true si quieres crear el usuario owner automáticamente
const CREATE_OWNER_USER = false;

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const tenantIdRaw = String(body?.tenantId || '').trim();
    const orderId = String(body?.orderId || '').trim();

    const tenantId = normalizeTenantId(tenantIdRaw);
    if (!tenantId || !orderId) return json({ error: 'Missing params.' }, 400);
    assertValidTenantId(tenantId);

    const tRef = adminDb.doc(`tenants/${tenantId}`);
    const oRef = adminDb.doc(`tenants/${tenantId}/tenantOrders/${orderId}`);
    const rRef = adminDb.doc(`reserved_subdomains/${tenantId}`);

    // 1) Lee tenant + order
    const [tSnap, oSnap] = await Promise.all([tRef.get(), oRef.get()]);
    if (!tSnap.exists || !oSnap.exists) return json({ error: 'Not found.' }, 404);

    const tenant = tSnap.data()!;
    const order = oSnap.data()!;

    // Idempotencia: si ya está provisionado, responde success de una vez.
    if (order.orderStatus === 'provisioned' && tenant.status === 'active') {
      const successUrl = buildSiteSuccessUrl(tenantId, orderId);
      return json({ ok: true, tenantId, orderId, successUrl }, 200);
    }

    if (order.orderStatus !== 'created') {
      return json({ error: 'Order is not in a creatable state.' }, 409);
    }

    const plan = (tenant.plan || order.plan) as PlanId;
    if (!['starter', 'pro', 'full'].includes(plan)) {
      return json({ error: 'Invalid plan on tenant/order.' }, 400);
    }

    // ✅ Usa el mapa centralizado
    const features: FeatureKey[] = PLAN_FEATURES[plan];

    // 2) (Opcional) Crear/obtener usuario owner en Firebase Auth (email/contraseña)
    //    Se hace antes de la transacción para tener el uid disponible.
    let ownerUid: string | undefined = tenant.owner?.uid;
    if (CREATE_OWNER_USER && tenant.owner?.email) {
      const auth = getAuth();
      const ownerEmail = String(tenant.owner.email).trim().toLowerCase();
      const ownerName = String(tenant.owner?.name || 'Owner').trim();

      try {
        const existing = await auth.getUserByEmail(ownerEmail);
        ownerUid = existing.uid;
      } catch {
        // Crear con contraseña temporal básica (reemplaza por una generada/segura si lo activas)
        const tempPassword = Math.random().toString(36).slice(2, 10) + 'A1!'; // ej. "k3j2l9p9A1!"
        const created = await auth.createUser({
          email: ownerEmail,
          emailVerified: false,
          password: tempPassword,
          displayName: ownerName,
          disabled: false,
        });
        ownerUid = created.uid;

        // (A futuro) Enviar correo "set your password" / "welcome" aquí.
      }
    }

    // 3) Transacción: aplicar features, activar tenant, provisionar order, limpiar reserva
    const now = Timestamp.now();
    await adminDb.runTransaction(async (trx) => {
      const t = await trx.get(tRef);
      const o = await trx.get(oRef);
      if (!t.exists || !o.exists) throw new Error('Not found.');
      const curT = t.data()!;
      const curO = o.data()!;

      // Re-validación de estados por seguridad
      if (curO.orderStatus !== 'created') {
        throw new Error('Order is not in a creatable state.');
      }

      // Actualizar tenant
      const updateTenant: Record<string, unknown> = {
        features,
        status: 'active',
        updatedAt: now,
      };
      if (ownerUid) {
        updateTenant.owner = { ...(curT.owner || {}), uid: ownerUid };
      }

      trx.update(tRef, updateTenant);

      // Actualizar order
      trx.update(oRef, { orderStatus: 'provisioned', updatedAt: now });

      // Borrar reserva
      trx.delete(rRef);
    });

    // 4) Success URL del **site** (no del subdominio del tenant), incluye orderId
    const successUrl = buildSiteSuccessUrl(tenantId, orderId);
    return json({ ok: true, tenantId, orderId, successUrl }, 200);
  } catch (err: any) {
    return json({ error: err?.message || 'Unexpected error.' }, 500);
  }
}

// Ahora devolvemos URL del site (no del subdominio del tenant) e incluimos orderId
function buildSiteSuccessUrl(tenantId: string, orderId: string) {
  return `/success?tenantId=${encodeURIComponent(tenantId)}&orderId=${encodeURIComponent(orderId)}`;
}
