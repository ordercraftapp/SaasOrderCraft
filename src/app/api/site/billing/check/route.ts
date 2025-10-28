export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantId = String(searchParams.get('tenantId') || '').trim();
    if (!tenantId) return NextResponse.json({ error: 'Missing tenantId' }, { status: 400 });

    const tRef = adminDb.doc(`tenants/${tenantId}`);
    const tSnap = await tRef.get();
    if (!tSnap.exists) return NextResponse.json({ block: true, reason: 'tenant-not-found' });

    const t = tSnap.data() as any;
    const status = String(t?.status || 'active');
    const billing = t?.billing || {};
    const trial = t?.trial || {};

    // Si ya está activo => no bloqueamos
    if (status === 'active' && (billing?.status === 'active' || trial?.enabled === false)) {
      return NextResponse.json({ block: false });
    }

    // Suspensión explícita
    if (status === 'suspended' || billing?.status === 'suspended') {
      // intentamos encontrar la orden "pendiente" más reciente para mostrar monto en paywall
      const o = await getLatestPendingOrder(tenantId);
      return NextResponse.json({
        block: true,
        reason: 'suspended',
        ...o,
      });
    }

    // Trial vencido
    const endsAt = trial?.endsAt;
    const ms = endsAt?.toMillis ? endsAt.toMillis() : endsAt;
    const expired = trial?.enabled === true && ms && Date.now() > ms;

    if (expired) {
      const o = await getLatestPendingOrder(tenantId);
      return NextResponse.json({
        block: true,
        reason: 'trial-expired',
        ...o,
      });
    }

    // Si trial activo o billing no activo pero no vencido => dejar pasar (banner, si lo implementas)
    return NextResponse.json({ block: false });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Internal error' }, { status: 200 });
  }
}

async function getLatestPendingOrder(tenantId: string) {
  try {
    const col = adminDb.collection(`tenants/${tenantId}/tenantOrders`);
    const q1 = await col.where('paymentStatus', 'in', ['pending', 'failed']).orderBy('createdAt', 'desc').limit(1).get();
    let d = q1.empty ? null : q1.docs[0];

    if (!d) {
      const q2 = await col.orderBy('createdAt', 'desc').limit(1).get();
      if (!q2.empty) d = q2.docs[0];
    }
    if (!d) return {};

    const data = d.data() as any;
    return {
      orderId: d.id,
      plan: data.planTier || data.plan || 'starter',
      amountCents: data.amountCents ?? 0,
      currency: (data.currency || 'USD').toUpperCase(),
    };
  } catch {
    return {};
  }
}
