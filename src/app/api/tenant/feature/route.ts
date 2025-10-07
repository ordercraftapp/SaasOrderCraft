// src/app/api/tenant/feature/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import { resolveTenantFromRequest, requireTenantId } from '@/lib/tenant/server';
import { hasFeature } from '@/lib/tenant/features';

export async function GET(req: NextRequest) {
  const tenantId = requireTenantId(resolveTenantFromRequest(req), 'api:GET /api/tenant/feature');
  const { searchParams } = new URL(req.url);
  const name = String(searchParams.get('name') || '');
  if (!name) return NextResponse.json({ ok: false, allowed: false }, { status: 400 });

  const allowed = await hasFeature(tenantId, name);
  return NextResponse.json({ ok: true, tenantId, feature: name, allowed });
}
