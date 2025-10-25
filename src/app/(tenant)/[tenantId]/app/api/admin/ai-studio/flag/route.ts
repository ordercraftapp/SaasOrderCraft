// src/app/(tenant)/[tenantId]/app/api/admin/ai-studio/flag/route.ts
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { resolveTenantFromRequest, requireTenantId } from '@/lib/tenant/server';
import { tDocAdmin } from '@/lib/db_admin';
import * as admin from 'firebase-admin';
import { requireAdmin } from '@/lib/security/authz'; // mantiene tu validación de admin

export async function GET(req: NextRequest, { params }: { params: { tenantId: string } }) {
  try {
    const tenantId = requireTenantId(
      resolveTenantFromRequest(req, params),
      'api:admin/ai-studio/flag:GET'
    );

    // si tu helper lo soporta:
    await requireAdmin(req);

    const ref = tDocAdmin('system_flags', tenantId, 'ai_studio');
    const snap = await ref.get();
    const data = snap.exists ? { enabled: !!snap.data()?.enabled } : { enabled: true };

    return NextResponse.json({ ok: true, data, tenantId }, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e: any) {
    const msg = e?.message || 'Unauthorized';
    const code = /unauthor|no user|no token/i.test(msg) ? 401
             : /forbid|no admin|insufficient/i.test(msg) ? 403
             : 500;
    return NextResponse.json({ ok: false, error: msg }, { status: code });
  }
}

export async function POST(req: NextRequest, { params }: { params: { tenantId: string } }) {
  try {
    const tenantId = requireTenantId(
      resolveTenantFromRequest(req, params),
      'api:admin/ai-studio/flag:POST'
    );

    await requireAdmin(req);

    const { enabled = false } = (await req.json().catch(() => ({}))) as { enabled?: boolean };

    const ref = tDocAdmin('system_flags', tenantId, 'ai_studio');
    await ref.set(
      {
        enabled: !!enabled,
        tenantId,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return NextResponse.json({ ok: true, data: { enabled: !!enabled }, tenantId }, {
      status: 200,
      headers: { 'Cache-Control': 'no-store' },
    });
  } catch (e: any) {
    const msg = e?.message || 'Unauthorized';
    const code = /unauthor|no user|no token/i.test(msg) ? 401
             : /forbid|no admin|insufficient/i.test(msg) ? 403
             : 500;
    return NextResponse.json({ ok: false, error: msg }, { status: code });
  }
}
