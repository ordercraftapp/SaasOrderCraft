export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { adminDb, adminAuth } from '@/lib/firebase/admin';
import { Timestamp } from 'firebase-admin/firestore';
import { normalizeTenantId, assertValidTenantId } from '@/lib/tenant/validate';
import { getAuth } from 'firebase-admin/auth';

// 🔗 Mapa centralizado de features por plan
import { PLAN_FEATURES } from '@/lib/plans/features';
import type { PlanTier as PlanId, FeatureKey } from '@/lib/plans/types';

function json(d: unknown, s = 200) {
  return NextResponse.json(d, { status: s });
}

// Cambia a true si quieres crear el usuario owner automáticamente (aquí no hace falta porque lo creas en /tenant-order)
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

    // 2) (Opcional) Crear/obtener usuario owner en Firebase Auth
    let ownerUid: string | undefined = tenant.owner?.uid;
    if (CREATE_OWNER_USER && tenant.owner?.email) {
      const auth = getAuth();
      const ownerEmail = String(tenant.owner.email).trim().toLowerCase();
      const ownerName = String(tenant.owner?.name || 'Owner').trim();

      try {
        const existing = await auth.getUserByEmail(ownerEmail);
        ownerUid = existing.uid;
      } catch {
        const tempPassword = Math.random().toString(36).slice(2, 10) + 'A1!';
        const created = await getAuth().createUser({
          email: ownerEmail,
          emailVerified: false,
          password: tempPassword,
          displayName: ownerName,
          disabled: false,
        });
        ownerUid = created.uid;
      }
    }

    // 3) Transacción: activar tenant, provisionar order, sembrar membresía (customers), limpiar reserva
    const now = Timestamp.now();
    let effectiveOwnerUid: string | undefined;

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
      const ownerFromTenant = (curT as any)?.owner || {};
      const ownerUidFromTenant = ownerUid || ownerFromTenant?.uid;
      if (ownerUidFromTenant) {
        updateTenant.owner = { ...(ownerFromTenant || {}), uid: ownerUidFromTenant };
      }

      trx.update(tRef, updateTenant);

      // Actualizar order
      trx.update(oRef, { orderStatus: 'provisioned', updatedAt: now });

      // 🟩 Si tenemos ownerUid efectivo, sembramos membresía del owner en customers/{uid}
      effectiveOwnerUid = ownerUidFromTenant;
      if (effectiveOwnerUid) {
        const email = (ownerFromTenant?.email || '').toString().trim().toLowerCase() || null;
        const displayName = (ownerFromTenant?.name || '').toString().trim() || null;

        const cRef = adminDb.doc(`tenants/${tenantId}/customers/${effectiveOwnerUid}`);
        trx.set(
          cRef,
          {
            uid: effectiveOwnerUid,
            tenantId,            // 🔐 refuerzo de scope
            email,
            displayName,
            phone: null,
            addresses: {
              home: { line1: '', city: '', country: '', zip: '', notes: '' },
              office: { line1: '', city: '', country: '', zip: '', notes: '' },
            },
            marketingOptIn: false,
            createdAt: now,
            updatedAt: now,
          },
          { merge: true }
        );
      }

      // Borrar reserva
      trx.delete(rRef);
    });

    // 4) Custom Claims por-tenant: set tenants[tenantId].roles.admin = true
    try {
      if (effectiveOwnerUid) {
        const userRec = await adminAuth.getUser(effectiveOwnerUid);
        const claims = (userRec.customClaims as any) || {};
        const tenantsClaims = { ...(claims.tenants || {}) };

        const existingForTenant = tenantsClaims[tenantId] || {};
        const existingRoles = { ...(existingForTenant.roles || {}) };

        tenantsClaims[tenantId] = {
          ...(existingForTenant || {}),
          roles: { ...existingRoles, admin: true }, // ← asigna admin solo en este tenant
        };

        const nextClaims = { ...claims, tenants: tenantsClaims };
        await adminAuth.setCustomUserClaims(effectiveOwnerUid, nextClaims);
      }
    } catch (e) {
      console.error('[provision-tenant] setCustomUserClaims failed:', e);
      // no bloquea la provisión
    }

    const successUrl = buildSiteSuccessUrl(tenantId, orderId);
    return json({ ok: true, tenantId, orderId, successUrl }, 200);
  } catch (err: any) {
    return json({ error: err?.message || 'Unexpected error.' }, 500);
  }
}

// URL del site (no del subdominio del tenant) e incluye orderId
function buildSiteSuccessUrl(tenantId: string, orderId: string) {
  return `/success?tenantId=${encodeURIComponent(tenantId)}&orderId=${encodeURIComponent(orderId)}`;
}
