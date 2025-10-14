// src/app/(tenant)/[tenantId]/app/api/customers/me/route.ts
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest } from '@/lib/server/auth';
import { verifyTurnstile } from '@/lib/security/turnstile';
import { resolveTenantFromRequest, requireTenantId } from '@/lib/tenant/server';
import { tDocAdmin } from '@/lib/db_admin';
import { FieldValue } from 'firebase-admin/firestore';

type Addr = {
  line1?: string;
  city?: string;
  country?: string;
  zip?: string;
  notes?: string;
};

type Billing = {
  name?: string;
  taxId?: string;
};

type CustomerDoc = {
  uid: string;
  email: string | null;
  displayName?: string | null;
  phone?: string | null;
  addresses?: { home?: Addr; office?: Addr };
  billing?: Billing;
  marketingOptIn?: boolean;
  createdAt?: any;
  updatedAt?: any;
  tenantId?: string;
};

const json = (d: unknown, s = 200) => NextResponse.json(d, { status: s });

function sanitizeAddr(a: any): Addr {
  const asStr = (v: any) => (typeof v === 'string' ? v : undefined);
  return {
    line1: asStr(a?.line1),
    city: asStr(a?.city),
    country: asStr(a?.country),
    zip: asStr(a?.zip),
    notes: asStr(a?.notes),
  };
}

export async function GET(req: NextRequest, { params }: { params: { tenantId: string } }) {
  try {
    const tenantId = requireTenantId(resolveTenantFromRequest(req, params), 'api:customers/me:GET');

    const user = await getUserFromRequest(req);
    if (!user) return json({ error: 'Unauthorized' }, 401);

    const uid = user.uid;
    const ref = tDocAdmin<CustomerDoc>('customers', tenantId, uid);
    const snap = await ref.get();

    if (!snap.exists) {
      // Crear doc inicial scopiado al tenant
      const now = FieldValue.serverTimestamp();
      const initial: CustomerDoc = {
        uid,
        email: user.email ?? null,
        displayName: (user as any)?.name || (user as any)?.displayName || null,
        phone: null,
        addresses: {
          home: { line1: '', city: '', country: '', zip: '', notes: '' },
          office: { line1: '', city: '', country: '', zip: '', notes: '' },
        },
        tenantId,
        createdAt: now,
        updatedAt: now,
      };
      await ref.set(initial, { merge: true });
      const saved = await ref.get();
      return json({ ok: true, customer: { id: saved.id, ...saved.data() }, tenantId });
    }

    const data = snap.data() as CustomerDoc;
    return json({ ok: true, customer: { id: snap.id, ...data }, tenantId });
  } catch (e: any) {
    console.error('[GET /api/customers/me] error:', e);
    return json({ error: e?.message || 'Server error' }, 500);
  }
}

export async function PUT(req: NextRequest, { params }: { params: { tenantId: string } }) {
  try {
    const tenantId = requireTenantId(resolveTenantFromRequest(req, params), 'api:customers/me:PUT');

    const user = await getUserFromRequest(req);
    if (!user) return json({ error: 'Unauthorized' }, 401);

    // Turnstile opcional (si el cliente manda x-turnstile-token)
    const tokenFromHeader = req.headers.get('x-turnstile-token') || undefined;
    if (tokenFromHeader) {
      const ok = await verifyTurnstile(tokenFromHeader);
      if (!ok) return json({ error: 'Captcha verification failed' }, 400);
    }

    const uid = user.uid;
    const body = await req.json().catch(() => ({} as any));

    // Campos permitidos
    const allowed: Partial<CustomerDoc> = {};

    if (typeof body.displayName === 'string') allowed.displayName = body.displayName;
    if (typeof body.phone === 'string') allowed.phone = body.phone;

    if (body?.addresses && typeof body.addresses === 'object') {
      const nextAddrs: any = {};
      if (body.addresses.home) nextAddrs.home = sanitizeAddr(body.addresses.home);
      if (body.addresses.office) nextAddrs.office = sanitizeAddr(body.addresses.office);
      allowed.addresses = nextAddrs;
    }

    // Billing
    if (body?.billing && typeof body.billing === 'object') {
      const b = body.billing;
      const nextBilling: Billing = {};
      if (typeof b.name === 'string') nextBilling.name = b.name;
      if (typeof b.taxId === 'string') nextBilling.taxId = b.taxId;
      allowed.billing = nextBilling;
    }

    // Marketing consent
    if (typeof body.marketingOptIn === 'boolean') {
      (allowed as any).marketingOptIn = body.marketingOptIn;
    }

    // Evitar cambios de uid/email desde aquí
    delete (allowed as any).uid;
    delete (allowed as any).email;

    if (!Object.keys(allowed).length) {
      return json({ error: 'No valid fields to update' }, 400);
    }

    const ref = tDocAdmin<CustomerDoc>('customers', tenantId, uid);
    const patch = {
      ...allowed,
      tenantId, // ✅ refuerza scope
      updatedAt: FieldValue.serverTimestamp(),
    };

    await ref.set(patch, { merge: true });

    const updated = await ref.get();
    return json({ ok: true, customer: { id: updated.id, ...updated.data() }, tenantId });
  } catch (e: any) {
    console.error('[PUT /api/customers/me] error:', e);
    return json({ error: e?.message || 'Server error' }, 500);
  }
}

/** ✅ Fallback: acepta POST como alias de PUT (mitiga 405 en algunos entornos) */
export async function POST(req: NextRequest, ctx: { params: { tenantId: string } }) {
  return PUT(req, ctx as any);
}
