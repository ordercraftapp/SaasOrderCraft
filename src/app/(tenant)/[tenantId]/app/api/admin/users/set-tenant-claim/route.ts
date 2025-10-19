// src/app/(tenant)/[tenantId]/app/api/admin/users/set-tenant-claim/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { adminAuth } from '@/lib/firebase/admin';
import { resolveTenantFromRequest, requireTenantId } from '@/lib/tenant/server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function getBearerToken(req: NextRequest) {
  const h = req.headers.get('authorization') || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

type Body = {
  uid?: string;        // puedes pasar uid directo
  email?: string;      // o email si prefieres buscarlo
  role?: 'customer' | 'cashier' | 'admin' | string; // por defecto 'customer'
};

export async function POST(req: NextRequest, { params }: { params: { tenantId: string }}) {
  try {
    // 1) Tenant scoping
    const tenantId = requireTenantId(
      resolveTenantFromRequest(req, params),
      'api:admin:set-tenant-claim:POST'
    );

    // 2) Solo admin global o admin del tenant (tú decides cómo verificar).
    //    Ejemplo simple: exigir bearer y claim "admin" en el token:
    const token = getBearerToken(req);
    if (!token) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    const decoded = await adminAuth.verifyIdToken(token);
    if (!decoded?.admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

    // 3) Leer body
    const body = (await req.json()) as Body;
    const role = body.role || 'customer';

    // 4) Resolver usuario por uid o email
    let userRecord = null;
    if (body.uid) userRecord = await adminAuth.getUser(body.uid);
    else if (body.email) userRecord = await adminAuth.getUserByEmail(body.email);
    else return NextResponse.json({ error: 'uid or email required' }, { status: 400 });

    // 5) Mezclar claims existentes con el mapa tenants
    const current = (userRecord.customClaims || {}) as any;
    const tenants = { ...(current.tenants || {}) };

    // Estructura: token.tenants[tenantId].roles.roleName = true
    tenants[tenantId] = {
      ...(tenants[tenantId] || {}),
      roles: {
        ...((tenants[tenantId] || {}).roles || {}),
        [role]: true,
      },
    };

    const newClaims = {
      ...current,
      // Si quieres mantener también un "tenantId" simple (opcional):
      // tenantId, // <- útil si tu app asume 1-tenant activo por usuario
      tenants,
    };

    // 6) Guardar claims
    await adminAuth.setCustomUserClaims(userRecord.uid, newClaims);

    return NextResponse.json({
      ok: true,
      tenantId,
      uid: userRecord.uid,
      appliedClaims: newClaims,
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Internal error' }, { status: 500 });
  }
}
