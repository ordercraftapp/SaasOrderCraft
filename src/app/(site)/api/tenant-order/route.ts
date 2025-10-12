// src/app/(site)/api/tenant-order/route.ts
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { Timestamp } from 'firebase-admin/firestore';
import { normalizeTenantId, assertValidTenantId } from '@/lib/tenant/validate';

type PlanId = 'starter' | 'pro' | 'full';

type CreateOrderBody = {
  plan: PlanId;
  companyName: string;
  adminName: string;
  adminEmail: string;
  phone?: string;
  address: {
    line1: string;
    line2?: string;
    city: string;
    region?: string;
    country: string;
    postalCode?: string;
  };
  desiredSubdomain: string;
};

function json(d: unknown, s = 200) {
  return NextResponse.json(d, { status: s });
}

const BLACKLIST = new Set(['www', 'app', 'api', 'admin', 'mail', 'root', 'support', 'status']);
const HOLD_MINUTES = 15;

/** =========================
 *  POST: crea tenant draft + tenantOrder (idempotente)
 *  ========================= */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CreateOrderBody;

    // -------- Validaciones básicas --------
    const plan = (body?.plan || 'starter') as PlanId;
    if (!['starter', 'pro', 'full'].includes(plan)) return json({ error: 'Invalid plan.' }, 400);

    const adminEmail = String(body?.adminEmail || '').trim();
    if (!adminEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adminEmail)) {
      return json({ error: 'Please provide a valid email.' }, 400);
    }

    const adminName = String(body?.adminName || '').trim();
    const companyName = String(body?.companyName || '').trim();
    if (!adminName || !companyName) return json({ error: 'Missing required fields.' }, 400);

    const desired = normalizeTenantId(String(body?.desiredSubdomain || ''));
    if (!desired) return json({ error: 'Invalid subdomain.' }, 400);
    assertValidTenantId(desired);
    if (BLACKLIST.has(desired)) return json({ error: 'This subdomain is reserved.' }, 400);

    const address = body?.address || ({} as any);
    if (!address.line1 || !address.city || !address.country) {
      return json({ error: 'Address is incomplete.' }, 400);
    }

    // -------- Refs --------
    const tRef = adminDb.doc(`tenants/${desired}`);
    const rRef = adminDb.doc(`reserved_subdomains/${desired}`);
    const ordersCol = adminDb.collection(`tenants/${desired}/tenantOrders`);

    // -------- Idempotencia previa a escribir --------
    // Si el tenant YA existe y es draft del site, devuelve la orden 'created' más reciente
    const existingTenantSnap = await tRef.get();
    if (existingTenantSnap.exists) {
      const t = existingTenantSnap.data() || {};
      if (t.status === 'draft' && t.reservedFromSite === true) {
        const q = await ordersCol
          .where('orderStatus', '==', 'created')
          .orderBy('createdAt', 'desc')
          .limit(1)
          .get();

        if (!q.empty) {
          const doc = q.docs[0];
          const res = json({ tenantId: desired, orderId: doc.id }, 200);
          
          res.cookies.set('tenantId', desired, { path: '/', httpOnly: false });
          return res;
        }
      }

      // Si ya está activo o no es el flujo de site draft → subdominio tomado
      return json({ error: 'This subdomain is already taken.' }, 409);
    }

    // -------- Transacción: revalidar reserva + crear tenant draft + order --------
    const result = await adminDb.runTransaction(async (trx) => {
      const now = Timestamp.now();

      // Verificación extra por carrera: ¿alguien creó el tenant mientras tanto?
      const tSnap = await trx.get(tRef);
      if (tSnap.exists) throw new Error('This subdomain is already taken.');

      // Reserva: si vigente → bloquear; si expirada/ausente → (re)crear por 15 min
      const rSnap = await trx.get(rRef);
      const newHold = Timestamp.fromMillis(now.toMillis() + HOLD_MINUTES * 60 * 1000);

      if (rSnap.exists) {
        const holdUntil = rSnap.get('holdUntil') as Timestamp | null;
        if (holdUntil && holdUntil.toMillis() > now.toMillis()) {
          throw new Error('This subdomain is being reserved. Try again later.');
        }
        trx.set(
          rRef,
          { name: desired, holdUntil: newHold, updatedAt: now, createdAt: rSnap.get('createdAt') || now },
          { merge: true },
        );
      } else {
        trx.set(rRef, { name: desired, holdUntil: newHold, createdAt: now });
      }

      // Crear tenant (draft)
      trx.set(tRef, {
        tenantId: desired,
        plan,
        status: 'draft',
        features: [], // se aplicarán en /provision-tenant
        owner: { name: adminName, email: adminEmail },
        company: {
          name: companyName,
          address: {
            line1: address.line1,
            line2: address.line2 || null,
            city: address.city,
            region: address.region || null,
            country: address.country,
            postalCode: address.postalCode || null,
          },
          phone: body?.phone || null,
        },
        reservedFromSite: true,
        createdAt: now,
        updatedAt: now,
        customDomain: null,
      });

      // Crear order (created)
      const orderRef = ordersCol.doc();
      trx.set(orderRef, {
        orderId: orderRef.id,
        plan,
        desiredSubdomain: desired,
        customer: { name: adminName, email: adminEmail },
        address: {
          line1: address.line1,
          line2: address.line2 || null,
          city: address.city,
          region: address.region || null,
          country: address.country,
          postalCode: address.postalCode || null,
        },
        amountCents: 0,
        currency: 'USD',
        paymentStatus: 'pending',
        orderStatus: 'created',
        createdAt: now,
        updatedAt: now,
      });

      return { tenantId: desired, orderId: orderRef.id };
    });

    // -------- (Opcional) Cookie tenantId para UI del site --------
    const res = json(result, 200);
  
    res.cookies.set('tenantId', result.tenantId, { path: '/', httpOnly: false });
    return res;
  } catch (err: any) {
    const msg = err?.message || 'Unexpected error.';
    const status = /taken|exists|reserved|being reserved/i.test(msg) ? 409 : 500;
    return json({ error: msg }, status);
  }
}

/** =========================
 *  GET: obtener resumen para checkout
 *  query: ?tenantId=...&orderId=...
 *  ========================= */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantIdRaw = String(searchParams.get('tenantId') || '').trim();
    const orderId = String(searchParams.get('orderId') || '').trim();

    const tenantId = normalizeTenantId(tenantIdRaw);
    if (!tenantId || !orderId) return json({ error: 'Missing params.' }, 400);
    assertValidTenantId(tenantId);

    const tRef = adminDb.doc(`tenants/${tenantId}`);
    const oRef = adminDb.doc(`tenants/${tenantId}/tenantOrders/${orderId}`);

    const [tSnap, oSnap] = await Promise.all([tRef.get(), oRef.get()]);
    if (!tSnap.exists || !oSnap.exists) return json({ error: 'Not found.' }, 404);

    const tData = tSnap.data()!;
    const oData = oSnap.data()!;

    const summary = {
      tenantId,
      orderId,
      plan: tData.plan,
      status: tData.status,
      desiredSubdomain: oData.desiredSubdomain,
      customer: oData.customer,
      company: tData.company,
      amountCents: oData.amountCents,
      currency: oData.currency,
      paymentStatus: oData.paymentStatus,
      orderStatus: oData.orderStatus,
      createdAt: oData.createdAt,
    };

    return json(summary, 200);
  } catch (err: any) {
    return json({ error: err?.message || 'Unexpected error.' }, 500);
  }
}
