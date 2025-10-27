export const runtime = 'nodejs';

import { NextResponse, NextRequest } from 'next/server';
import { resolveTenantFromRequest, requireTenantId } from '@/lib/tenant/server';
import { getTenantPaypalPublic } from '@/lib/payments/paypal';

export async function GET(req: NextRequest, ctx: { params: { tenant: string } }) {
  const tenantId = requireTenantId(resolveTenantFromRequest(req, ctx?.params), 'api:/pay/paypal/sdk-params');
  const cfg = await getTenantPaypalPublic(tenantId);
  if (!cfg?.enabled) {
    return NextResponse.json({ enabled: false }, { status: 200 });
  }
  return NextResponse.json({
    enabled: true,
    clientId: cfg.clientId,
    currency: cfg.currency,
    mode: cfg.mode, // por si quieres mostrarlo
  });
}
