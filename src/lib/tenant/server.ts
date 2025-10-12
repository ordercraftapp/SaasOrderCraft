// src/lib/tenant/server.ts
import { NextRequest, NextResponse } from 'next/server';

export type TenantRouteParams = {
  tenant?: string | string[];
  tenantId?: string | string[];
  // Permite pasar ctx.params completo sin que TS se queje
  [k: string]: unknown;
};

function normalizeParam(v?: string | string[] | null): string | null {
  if (!v) return null;
  return Array.isArray(v) ? (v[0] ?? null) : v;
}

/** Obtiene tenantId a partir de params de ruta soportando [tenant] y [tenantId] */
export function currentTenantIdServer(params?: TenantRouteParams | null) {
  if (!params) return null;
  const tId = normalizeParam(params.tenantId);
  const t = normalizeParam(params.tenant);
  return tId ?? t ?? null;
}

/**
 * Resuelve el tenantId, priorizando:
 * 1) Header `x-tenant-id` (si tu middleware lo inyecta)
 * 2) Param de ruta: soporta tanto [tenantId] como [tenant]
 * 3) Path reescrito: /(...)/(tenant)/{id}/app/api/...
 */
export function resolveTenantFromRequest(
  req: NextRequest,
  params?: TenantRouteParams
): string | null {
  // 1) header
  const hdr = req.headers.get('x-tenant-id')?.trim();
  if (hdr) return hdr;

  // 2) params
  const fromParams = currentTenantIdServer(params ?? null);
  if (fromParams) return fromParams;

  // 3) path: busca el segmento literal "(tenant)" y toma el siguiente
  const url = new URL(req.url);
  const parts = url.pathname.split('/').filter(Boolean);
  const i = parts.indexOf('(tenant)');
  if (i >= 0 && parts[i + 1]) return parts[i + 1];

  return null;
}

export function requireTenantId(tenantId: string | null, where: string) {
  if (!tenantId) {
    // Lanzamos NextResponse para respetar el estilo de App Router
    throw new NextResponse(`Missing tenantId in ${where}`, { status: 400 }) as unknown as Error;
  }
  return tenantId;
}
