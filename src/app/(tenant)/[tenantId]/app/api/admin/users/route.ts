// src/app/(tenant)/[tenantId]/app/api/admin/users/route.ts
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

export async function GET(req: NextRequest, { params }: { params: { tenantId: string } }) {
  try {
    // 🔐 Tenant
    const tenantId = requireTenantId(
      resolveTenantFromRequest(req, params),
      'api:admin/users:GET'
    );

    // 🔐 Admin via bearer
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const decoded = await adminAuth.verifyIdToken(token);
    if (!decoded?.admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // 📦 Params
    const { searchParams } = new URL(req.url);
    const limitParam = Number(searchParams.get('limit') || 50);
    const limit = Math.min(Math.max(1, limitParam), 1000);

    // 👥 Intento 1: usuarios definidos en el tenant
    const usersCol = tColAdmin('users', tenantId);
    const usersSnap = await usersCol.limit(limit).get();

    if (!usersSnap.empty) {
      const uids: string[] = [];
      usersSnap.forEach((d) => {
        const data = d.data() as any;
        const uid = (data?.uid as string) || d.id;
        if (uid) uids.push(uid);
      });

      const userRecords = await Promise.allSettled(uids.map((uid) => adminAuth.getUser(uid)));
      const users = userRecords
        .filter((r): r is PromiseFulfilledResult<import('firebase-admin').auth.UserRecord> => r.status === 'fulfilled')
        .map((r) => r.value)
        .map((u) => ({
          uid: u.uid,
          email: u.email,
          displayName: u.displayName,
          disabled: u.disabled,
          claims: u.customClaims || {},
          metadata: {
            creationTime: u.metadata?.creationTime,
            lastSignInTime: u.metadata?.lastSignInTime,
          },
        }));

      return NextResponse.json({ ok: true, tenantId, source: 'tenantUsers', users });
    }

    // 👥 Fallback: listado global (como el original), útil si aún no has poblado tenants/{tenantId}/users
    const list = await adminAuth.listUsers(limit);
    const users = list.users.map((u) => ({
      uid: u.uid,
      email: u.email,
      displayName: u.displayName,
      disabled: u.disabled,
      claims: u.customClaims || {},
      metadata: {
        creationTime: u.metadata?.creationTime,
        lastSignInTime: u.metadata?.lastSignInTime,
      },
    }));

    return NextResponse.json({ ok: true, tenantId, source: 'authList', users });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Internal error' }, { status: 500 });
  }
}
