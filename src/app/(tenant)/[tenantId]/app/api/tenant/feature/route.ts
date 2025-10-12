// src/app/(tenant)/[tenantId]/app/api/tenant/feature/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import { resolveTenantFromRequest, requireTenantId } from '@/lib/tenant/server';
import { hasFeature } from '@/lib/tenant/features';

// Recomendado: evita caché de route handler (feature flags suelen cambiar a menudo)
export const dynamic = 'force-dynamic';

export async function GET(
  req: NextRequest,
  ctx: { params: { tenantId: string } } // ✅ recibe params
) {
  // ✅ pasar params al resolver
  const tenantId = requireTenantId(
    resolveTenantFromRequest(req, ctx.params),
    'api:GET /api/tenant/feature'
  );

  const { searchParams } = new URL(req.url);
  const name = String(searchParams.get('name') || '');
  if (!name) {
    return NextResponse.json({ ok: false, allowed: false }, { status: 400 });
  }

  const allowed = await hasFeature(tenantId, name);

  // opcional: marcar no-store explícito
  const res = NextResponse.json({ ok: true, tenantId, feature: name, allowed });
  res.headers.set('Cache-Control', 'no-store'); // opcional
  return res;
}
