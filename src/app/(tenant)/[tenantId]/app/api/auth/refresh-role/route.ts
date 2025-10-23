// src/app/(tenant)/[tenantId]/app/api/auth/refresh-role/route.ts
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb, FieldValue } from '@/lib/firebase/admin';
import { resolveTenantFromRequest, requireTenantId } from '@/lib/tenant/server';

// Prioridad: admin > kitchen > cashier > waiter > delivery
const OP_ROLES = ['admin', 'kitchen', 'cashier', 'waiter', 'delivery'] as const;
type OpRole = typeof OP_ROLES[number];

type MemberDoc = { uid: string; role: string; createdAt?: any; updatedAt?: any };
type TenantDoc = { owner?: { uid?: string; email?: string; name?: string } };

function json(d: unknown, s = 200) {
  return NextResponse.json(d, { status: s });
}

/** Normaliza el nodo de tenant (acepta plano, roles, flags, rolesNormalized) */
function normalizeTenantNode(node: any): Record<string, boolean> {
  if (!node || typeof node !== 'object') return {};
  const out: Record<string, boolean> = {};
  const merge = (src: any) => {
    if (!src || typeof src !== 'object') return;
    for (const k of Object.keys(src)) {
      if (typeof src[k] === 'boolean') out[k] ||= !!src[k];
    }
  };
  merge(node);                    // { admin:true }
  merge(node?.roles);             // { roles:{ admin:true } }
  merge(node?.flags);             // { flags:{ admin:true } }
  merge(node?.rolesNormalized);   // { rolesNormalized:{ admin:true } }
  return out;
}

/** Elige rol a partir de claims (tenant-aware), con fallback a global */
function pickTenantRoleFromClaims(claims: any, tenantId: string): OpRole | 'customer' {
  const flags = normalizeTenantNode(claims?.tenants?.[tenantId] || {});
  const isGlobalAdmin = claims?.admin === true || claims?.role === 'admin' || claims?.role === 'superadmin';
  if (isGlobalAdmin) flags.admin = true;

  for (const r of OP_ROLES) {
    if (flags[r]) return r;
  }

  // fallback global legacy
  if (typeof claims?.role === 'string' && (OP_ROLES as readonly string[]).includes(claims.role as OpRole)) {
    return claims.role as OpRole;
  }
  for (const r of OP_ROLES) {
    if (claims?.[r] === true) return r;
  }

  return 'customer';
}

/** Asegura que el usuario tenga customClaims por tenant en formato PLANO */
async function ensureTenantClaims(uid: string, tenantId: string, resolvedRole: string) {
  const user = await adminAuth.getUser(uid);
  const current = (user.customClaims || {}) as any;

  const tenants = { ...(current.tenants || {}) };
  const prevFlags = normalizeTenantNode(tenants[tenantId] || {});

  // siempre customer; si corresponde, añade el rol operativo
  const nextFlags: Record<string, boolean> = { ...prevFlags, customer: true };
  if (['admin','kitchen','cashier','waiter','delivery'].includes(resolvedRole)) {
    nextFlags[resolvedRole] = true;
  }

  // guardar **plano**: tenants[tenantId] = { admin:true, ... }
  tenants[tenantId] = nextFlags;

  const nextClaims = { ...current, tenantId, tenants };

  const changed = JSON.stringify(current) !== JSON.stringify(nextClaims);
  if (changed) {
    await adminAuth.setCustomUserClaims(uid, nextClaims);
  }
  return changed;
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

  // ✅ Verificar token con claims FRESCOS
  const decoded = await adminAuth.verifyIdToken(token, true);
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
    role = pickTenantRoleFromClaims(claims, tenantId);
  }

  // ✅ Asegurar customClaims por tenant (formato plano)
  const claimsUpdated = await ensureTenantClaims(uid, tenantId, role);

  // 🍪 Cookies legibles por middleware (no httpOnly) — scopiadas al TENANT
  const res = json({ ok: true, tenantId, role, claimsUpdated });

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
