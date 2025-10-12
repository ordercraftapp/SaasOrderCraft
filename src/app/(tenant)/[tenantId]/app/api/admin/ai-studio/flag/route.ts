// src/app/(tenant)/[tenantId]/app/api/admin/ai-studio/flag/route.ts
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { resolveTenantFromRequest, requireTenantId } from '@/lib/tenant/server';
import { tDocAdmin } from '@/lib/db_admin';
import * as admin from 'firebase-admin';
import { requireAdmin } from '@/lib/security/authz'; // mantiene tu validación de admin

export async function GET(req: NextRequest, { params }: { params: { tenantId: string } }) {
  try {
    await requireAdmin(req);

    const tenantId = requireTenantId(
      resolveTenantFromRequest(req, params),
      'api:admin/ai-studio/flag:GET'
    );

    const ref = tDocAdmin('system_flags', tenantId, 'ai_studio');
    const snap = await ref.get();
    const data = snap.exists ? snap.data() : { enabled: true };

    return NextResponse.json({ ok: true, data, tenantId });
  } catch (e: any) {
    const msg = e?.message || 'Unauthorized';
    const code = /unauthorized/i.test(msg) ? 401 : /forbidden/i.test(msg) ? 403 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status: code });
  }
}

export async function POST(req: NextRequest, { params }: { params: { tenantId: string } }) {
  try {
    await requireAdmin(req);

    const tenantId = requireTenantId(
      resolveTenantFromRequest(req, params),
      'api:admin/ai-studio/flag:POST'
    );

    const body = await req.json().catch(() => ({}));
    const enabled = !!body.enabled;

    const ref = tDocAdmin('system_flags', tenantId, 'ai_studio');
    await ref.set(
      {
        enabled,
        tenantId, // ✅ regla de estilo
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return NextResponse.json({ ok: true, data: { enabled }, tenantId });
  } catch (e: any) {
    const msg = e?.message || 'Unauthorized';
    const code = /unauthorized/i.test(msg) ? 401 : /forbidden/i.test(msg) ? 403 : 500;
    return NextResponse.json({ ok: false, error: msg }, { status: code });
  }
}
