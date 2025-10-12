// src/app/(tenant)/[tenantId]/app/api/_status/firestore/route.ts
export const runtime = 'nodejs';

// ✅ Tenant-aware API
import { NextRequest, NextResponse } from 'next/server';
import { resolveTenantFromRequest, requireTenantId } from '@/lib/tenant/server';
import { tDocAdmin } from '@/lib/db_admin';

export async function GET(req: NextRequest, { params }: { params: { tenantId: string } }) {
  try {
    // 🔐 Tenant
    const tenantId = requireTenantId(
      resolveTenantFromRequest(req, params),
      'api:_status/firestore'
    );

    // 🔧 Ping en subcolección del tenant
    const ref = tDocAdmin('_status', tenantId, '_ping');
    await ref.set({ tenantId, ts: Date.now() }, { merge: true });

    return NextResponse.json({ firestore: 'ok', tenantId });
  } catch (e: any) {
    return NextResponse.json(
      { firestore: 'error', message: e?.message ?? String(e) },
      { status: 500 }
    );
  }
}
