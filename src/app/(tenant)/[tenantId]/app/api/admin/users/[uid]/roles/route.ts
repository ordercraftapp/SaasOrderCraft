// src/app/(tenant)/[tenantId]/app/api/admin/users/[uid]/roles/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { resolveTenantFromRequest, requireTenantId } from '@/lib/tenant/server';
import { tColAdmin } from '@/lib/db_admin';
import { adminAuth } from '@/lib/firebase/admin';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getBearerToken(req: NextRequest) {
  const h = req.headers.get('authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

const ALLOWED_KEYS = ['admin', 'kitchen', 'waiter', 'delivery', 'cashier'] as const;
type RoleKey = (typeof ALLOWED_KEYS)[number];

export async function PATCH(
  req: NextRequest,
  { params }: { params: { tenantId: string; uid: string } }
) {
  try {
    // ✅ Tenant
    const tenantId = requireTenantId(
      resolveTenantFromRequest(req, params),
      'api:admin/users/[uid]/roles:PATCH'
    );

    // 🔐 Auth (admin via bearer)
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const decoded = await adminAuth.verifyIdToken(token);
    if (!decoded?.admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // 🔎 Target UID
    const uid = params?.uid;
    if (!uid) return NextResponse.json({ error: 'Missing uid' }, { status: 400 });

    // 📦 Body → solo keys permitidas
    const body = await req.json().catch(() => ({}));
    const nextClaims: Partial<Record<RoleKey, boolean>> = {};
    for (const k of ALLOWED_KEYS) {
      if (typeof body[k] === 'boolean') nextClaims[k] = !!body[k];
    }
    if (Object.keys(nextClaims).length === 0) {
      return NextResponse.json({ error: 'No role fields provided' }, { status: 400 });
    }

    // 🔁 Merge con claims actuales
    const user = await adminAuth.getUser(uid);
    const current = (user.customClaims || {}) as Record<string, any>;
    const merged = { ...current, ...nextClaims };

    // 💾 Persistir claims
    await adminAuth.setCustomUserClaims(uid, merged);

    // 🧾 Auditoría por tenant
    await tColAdmin('_admin_audit', tenantId).add({
      at: new Date().toISOString(),
      by: decoded?.uid ?? null,
      target: uid,
      claims: merged,
      type: 'setRoles',
      tenantId, // ✅ regla de estilo
    });

    return NextResponse.json({
      ok: true,
      tenantId,
      claims: merged,
      note: 'El usuario debe renovar sesión o refrescar su ID token para ver los cambios.',
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Internal error' }, { status: 500 });
  }
}
