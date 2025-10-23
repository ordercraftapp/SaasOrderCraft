// src/app/(tenant)/[tenantId]/app/api/auth/refresh-role/route.ts
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { adminAuth, adminDb, FieldValue } from '@/lib/firebase/admin';
import { resolveTenantFromRequest, requireTenantId } from '@/lib/tenant/server';

// ⚠️ Mantengo tu orden original para minimizar cambios:
// admin > kitchen > waiter > delivery > cashier
const OP_ROLES = ['admin', 'kitchen', 'waiter', 'delivery', 'cashier'] as const;
type OpRole = typeof OP_ROLES[number];

type MemberDoc = { uid: string; role: string; createdAt?: any; updatedAt?: any };
type TenantDoc = { owner?: { uid?: string; email?: string; name?: string } };

function json(d: unknown, s = 200) {
  return NextResponse.json(d, { status: s });
}

/** Compat: normaliza nodo del tenant pero sin cambiar el formato que escribimos */
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

/** Compat: primero intenta roles map, pero acepta plano/flags si existieran */
function pickTenantRoleFromClaims(claims: any, tenantId: string): OpRole | 'customer' {
  // 1) si existe roles map, respétalo (comportamiento original)
  try {
    const rolesMap = claims?.tenants?.[tenantId]?.roles || {};
    for (const r of OP_ROLES) {
      if (rolesMap?.[r] === true) return r;
    }
  } catch { /* ignore */ }

  // 2) fallback flexible (plano/flags/rolesNormalized)
  const flags = normalizeTenantNode(claims?.tenants?.[tenantId] || {});
  // admin global/superadmin cuenta como admin
  if (claims?.admin === true || claims?.role === 'admin' || claims?.role === 'superadmin') {
    flags.admin = true;
  }
  for (const r of OP_ROLES) {
    if (flags[r]) return r;
  }

  // 3) último fallback: global legacy
  if (typeof claims?.role === 'string' && (OP_ROLES as readonly string[]).includes(claims.role as OpRole)) {
    return claims.role as OpRole;
  }
  for (const r of OP_ROLES) {
    if (claims?.[r] === true) return r;
  }

  return 'customer';
}

/** Compat: conservamos escritura bajo tenants[tenantId].roles (no aplanamos) */
async function ensureTenantClaims(uid: string, tenantId: string, resolvedRole: string) {
  const user = await adminAuth.getUser(uid);
  const current = (user.customClaims || {}) as any;

  const tenants = { ...(current.tenants || {}) };
  const currentRoles = { ...((tenants[tenantId]?.roles) || {}) };

  // siempre marcar customer; si es staff/admin, también su rol
  const nextRoles: Record<string, boolean> = { ...currentRoles, customer: true };
  if (['admin','kitchen','cashier','waiter','delivery'].includes(resolvedRole)) {
    nextRoles[resolvedRole] = true;
  }

  tenants[tenantId] = { ...(tenants[tenantId] || {}), roles: nextRoles };

  // ⚠️ Compat: no añadimos otros campos nuevos en claims; mantenemos lo que ya usabas
  const nextClaims = { ...current, tenants };

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

  // ✅ Claims FRESCOS (único cambio funcional imprescindible)
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

  // 2) 🪄 Auto-seed si es owner del tenant y no hay membresía
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

  // 4) Compat: mantener escritura bajo tenants[tenantId].roles
  const claimsUpdated = await ensureTenantClaims(uid, tenantId, role);

  // 🍪 Cookies legibles por middleware — scopiadas al TENANT
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

// ✅ Soporta POST y GET
export async function POST(req: NextRequest, ctx: { params: { tenantId: string } }) {
  try { return await handleRefresh(req, ctx.params); }
  catch (err: any) { return json({ ok: false, error: err?.message || 'verifyIdToken failed' }, 401); }
}
export async function GET(req: NextRequest, ctx: { params: { tenantId: string } }) {
  try { return await handleRefresh(req, ctx.params); }
  catch (err: any) { return json({ ok: false, error: err?.message || 'verifyIdToken failed' }, 401); }
}
