export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb, FieldValue } from '@/lib/firebase/admin';
import { resolveTenantFromRequest, requireTenantId } from '@/lib/tenant/server';

const OP_ROLES = ['admin', 'kitchen', 'waiter', 'delivery', 'cashier'] as const;
type OpRole = typeof OP_ROLES[number];

type MemberDoc = { uid: string; role: string; createdAt?: any; updatedAt?: any };
type TenantDoc = { owner?: { uid?: string; email?: string; name?: string } };

function json(d: unknown, s = 200) {
  return NextResponse.json(d, { status: s });
}

function pickTenantRoleFromClaims(claims: any, tenantId: string): OpRole | 'customer' {
  try {
    const t = claims?.tenants?.[tenantId];
    const rolesMap = t?.roles || {};
    for (const r of OP_ROLES) {
      if (rolesMap?.[r] === true) return r;
    }
  } catch { /* ignore */ }
  return 'customer';
}

async function handleRefresh(req: NextRequest, params: { tenantId: string }) {
  const isProd = process.env.NODE_ENV === 'production';

  // 🔐 Tenant
  const tenantId = requireTenantId(
    resolveTenantFromRequest(req, params),
    'app/api:auth/refresh-role'
  );

  // 🔑 Bearer
  const authHeader = req.headers.get('authorization') ?? req.headers.get('Authorization');
  const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;
  if (!token) return json({ ok: false, error: 'Missing Bearer token' }, 401);

  // ✅ Verificar token con Admin SDK
  const decoded = await adminAuth.verifyIdToken(token);
  const claims = decoded as any;
  const uid = decoded.uid;
  const emailLower = claims?.email ? String(claims.email).toLowerCase() : null;

  let role: OpRole | 'customer' | null = null;

  // 1) 🔎 Intentar rol desde Firestore: members/{uid}
  const mRef = adminDb.doc(`tenants/${tenantId}/members/${uid}`);
  const mSnap = await mRef.get();
  if (mSnap.exists) {
    const data = (mSnap.data() || {}) as MemberDoc;
    const r = String(data.role || '').toLowerCase();
    if ((OP_ROLES as readonly string[]).includes(r as OpRole)) {
      role = r as OpRole;
    }
  }

  // 2) 🪄 Auto-seed si es el OWNER del tenant (por email o uid) y no hay membresía
  if (!role) {
    const tRef = adminDb.doc(`tenants/${tenantId}`);
    const tSnap = await tRef.get();
    if (tSnap.exists) {
      const t = (tSnap.data() || {}) as TenantDoc;
      const ownerEmailLower = t?.owner?.email ? String(t.owner.email).toLowerCase() : null;
      const ownerUid = t?.owner?.uid || null;

      const isOwner =
        (ownerUid && ownerUid === uid) ||
        (!!ownerEmailLower && !!emailLower && ownerEmailLower === emailLower);

      if (isOwner) {
        await mRef.set(
          { uid, role: 'admin', createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() },
          { merge: true }
        );
        role = 'admin';
      }
    }
  }

  // 3) Fallback a claims por-tenant → global
  if (!role) {
    let fromClaims = pickTenantRoleFromClaims(claims, tenantId);
    if (fromClaims === 'customer') {
      if (typeof claims?.role === 'string' && (OP_ROLES as readonly string[]).includes(claims.role as OpRole)) {
        fromClaims = claims.role as OpRole;
      } else {
        for (const r of OP_ROLES) {
          if (claims?.[r] === true) { fromClaims = r; break; }
        }
      }
    }
    role = fromClaims || 'customer';
  }

  // 🍪 Cookies legibles por middleware (no httpOnly) — scopiadas al TENANT
  const res = json({ ok: true, tenantId, role });

  res.cookies.set('appRole', role, {
    httpOnly: false,
    sameSite: 'lax',
    secure: isProd,
    path: `/${tenantId}/app/`,
    maxAge: 60 * 60 * 24 * 7,
  });

  res.cookies.set('isOp', String((OP_ROLES as readonly string[]).includes(role as OpRole)), {
    httpOnly: false,
    sameSite: 'lax',
    secure: isProd,
    path: `/${tenantId}/app/`,
    maxAge: 60 * 60 * 24 * 7,
  });

  return res;
}

// ✅ Soporta POST y GET (algunos clientes hacían GET → 405)
export async function POST(req: NextRequest, ctx: { params: { tenantId: string } }) {
  try { return await handleRefresh(req, ctx.params); }
  catch (err: any) { return json({ ok: false, error: err?.message || 'verifyIdToken failed' }, 401); }
}
export async function GET(req: NextRequest, ctx: { params: { tenantId: string } }) {
  try { return await handleRefresh(req, ctx.params); }
  catch (err: any) { return json({ ok: false, error: err?.message || 'verifyIdToken failed' }, 401); }
}
