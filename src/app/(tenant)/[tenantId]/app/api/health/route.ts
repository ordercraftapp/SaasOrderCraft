// src/app/(tenant)/[tenantId]/app/api/health/route.ts
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { resolveTenantFromRequest, requireTenantId } from '@/lib/tenant/server';

export async function GET(req: NextRequest, { params }: { params: { tenantId: string } }) {
  const requestId =
    (req.headers.get?.('x-request-id') as string | null) ?? 'no-request-id';

  const tenantId = requireTenantId(
    resolveTenantFromRequest(req, params),
    'api:health:GET'
  );

  return NextResponse.json({
    ok: true,
    tenantId,
    env: process.env.APP_ENV ?? 'unknown',
    version: process.env.APP_VERSION ?? '0.0.0',
    requestId,
    now: new Date().toISOString(),
  });
}
