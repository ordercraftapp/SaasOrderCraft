export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { normalizeTenantId, assertValidTenantId } from '@/lib/tenant/validate';

function json(d: unknown, s = 200) {
  return NextResponse.json(d, { status: s });
}

/**
 * Devuelve la mejor orden “candidata” para upgrade:
 * 1) La más reciente con orderStatus == 'created'
 * 2) Si no hay, la más reciente (por updatedAt o createdAt)
 * Respuesta: { orderId: string }
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantRaw = String(searchParams.get('tenantId') || '').trim();
    const tenantId = normalizeTenantId(tenantRaw);
    if (!tenantId) return json({ error: 'Missing tenantId' }, 400);
    assertValidTenantId(tenantId);

    const col = adminDb.collection(`tenants/${tenantId}/tenantOrders`);

    // 1) Preferimos una orden en estado 'created'
    const q1 = await col
      .where('orderStatus', '==', 'created')
      .orderBy('createdAt', 'desc')
      .limit(1)
      .get();

    if (!q1.empty) {
      const doc = q1.docs[0];
      const orderId = (doc.get('orderId') as string) || doc.id;
      return json({ orderId }, 200);
    }

    // 2) Si no hay 'created', tomamos la más reciente por updatedAt o createdAt
    // Intento por updatedAt
    const q2 = await col.orderBy('updatedAt', 'desc').limit(1).get();
    if (!q2.empty) {
      const doc = q2.docs[0];
      const orderId = (doc.get('orderId') as string) || doc.id;
      return json({ orderId }, 200);
    }

    // Fallback por createdAt (en caso de docs antiguos)
    const q3 = await col.orderBy('createdAt', 'desc').limit(1).get();
    if (!q3.empty) {
      const doc = q3.docs[0];
      const orderId = (doc.get('orderId') as string) || doc.id;
      return json({ orderId }, 200);
    }

    // Nada encontrado
    return json({ error: 'No order found for this tenant' }, 404);
  } catch (e: any) {
    return json({ error: e?.message || 'Unexpected error' }, 500);
  }
}
