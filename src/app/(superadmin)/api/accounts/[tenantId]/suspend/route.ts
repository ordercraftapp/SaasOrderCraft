export const runtime = 'nodejs';
import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { Timestamp } from 'firebase-admin/firestore';

export async function POST(_req: NextRequest, { params }: { params: { tenantId: string }}) {
  const { tenantId } = params;
  const ref = adminDb.doc(`tenants/${tenantId}`);
  await ref.update({
    status: 'suspended',
    statusReason: 'manual:suspended-by-superadmin',
    updatedAt: Timestamp.now(),
  });
  return NextResponse.json({ ok: true });
}
