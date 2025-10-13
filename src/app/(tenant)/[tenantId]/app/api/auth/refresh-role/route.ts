export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase/admin';
import { resolveTenantFromRequest, requireTenantId } from '@/lib/tenant/server';

const OP_ROLES = ['admin', 'kitchen', 'waiter', 'delivery', 'cashier'] as const;
type OpRole = typeof OP_ROLES[number];

function pickTenantRole(claims: any, tenantId: string): OpRole | 'customer' {
  try {
    const t = claims?.tenants?.[tenantId];
    const rolesMap = t?.roles || {};
    // Prioridad: admin > kitchen > cashier > waiter > delivery (ajusta si quieres otro orden)
    for (const r of OP_ROLES) {
      if (rolesMap?.[r] === true) return r;
    }
  } catch { /* ignore */ }
  return 'customer';
}

export async function POST(req: NextRequest, { params }: { params: { tenantId: string } }) {
  const isProd = process.env.NODE_ENV === 'production';

  try {
    // 🔐 Tenant
    const tenantId = requireTenantId(
      resolveTenantFromRequest(req, params),
      'api:auth/refresh-role:POST'
    );

    // 🔑 Bearer
    const authHeader = req.headers.get('authorization') ?? req.headers.get('Authorization');
    const token = authHeader?.startsWith('Bearer ') ? authHeader.slice(7) : null;

    if (!token) {
      return NextResponse.json({ ok: false, error: 'Missing Bearer token' }, { status: 401 });
    }

    // ✅ Verificar token con Admin SDK
    const decoded = await adminAuth.verifyIdToken(token);
    const customClaims = decoded as any;

    // 1) Intenta por-tenant
    let role: OpRole | 'customer' = pickTenantRole(customClaims, tenantId);

    // 2) Fallback a tu lógica previa (global)
    if (role === 'customer') {
      if (typeof customClaims?.role === 'string' && (OP_ROLES as readonly string[]).includes(customClaims.role)) {
        role = customClaims.role as OpRole;
      } else {
        for (const r of OP_ROLES) {
          if (customClaims?.[r] === true) { role = r; break; }
        }
      }
    }

    // 🍪 Cookies legibles por middleware (no httpOnly)
    const res = NextResponse.json({ ok: true, tenantId, role });

    res.cookies.set('appRole', role, {
      httpOnly: false,
      sameSite: 'lax',
      secure: isProd,
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    });

    res.cookies.set('isOp', String((OP_ROLES as readonly string[]).includes(role)), {
      httpOnly: false,
      sameSite: 'lax',
      secure: isProd,
      path: '/',
      maxAge: 60 * 60 * 24 * 7,
    });

    return res;
  } catch (err: any) {
    return NextResponse.json(
      { ok: false, error: err?.message || 'verifyIdToken failed' },
      { status: 401 }
    );
  }
}
