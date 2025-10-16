// src/lib/tenant/server.ts
import { NextRequest, NextResponse } from 'next/server';

export type TenantRouteParams = {
  tenant?: string | string[];
  tenantId?: string | string[];
  [k: string]: unknown;
};

function normalizeParam(v?: string | string[] | null): string | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

export function currentTenantIdServer(params?: TenantRouteParams | null) {
  if (!params) return null;
  const tId = normalizeParam(params.tenantId);
  const t = normalizeParam(params.tenant);
  return tId ?? t ?? null;
}

/**
 * Resuelve tenantId con prioridad:
 * 1) Header `x-tenant-id` (estándar nuevo)
 * 2) Header `x-tenant` (compat)
 * 3) Params de ruta ([tenantId] o [tenant])
 * 4) Path reescrito (/(tenant)/{id}/...)
 */
export function resolveTenantFromRequest(
  req: NextRequest,
  params?: TenantRouteParams
): string | null {
  const h = req.headers;
  const h1 = h.get('x-tenant-id')?.trim();
  if (h1) return h1;

  const hCompat = h.get('x-tenant')?.trim();
  if (hCompat) return hCompat;

  const fromParams = currentTenantIdServer(params ?? null);
  if (fromParams) return fromParams;

  const url = new URL(req.url);
  const parts = url.pathname.split('/').filter(Boolean);
  const i = parts.indexOf('(tenant)');
  if (i >= 0 && parts[i + 1]) return parts[i + 1];

  return null;
}

export function requireTenantId(tenantId: string | null, where: string) {
  if (!tenantId) {
    throw new NextResponse(`Missing tenantId in ${where}`, { status: 400 }) as unknown as Error;
  }
  return tenantId;
}
