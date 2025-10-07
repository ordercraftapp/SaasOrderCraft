// src/lib/tenant/server.ts
// PhaseC — helpers server-only para resolver tenantId de forma consistente
// Compat con distintas versiones de Next (headers/cookies API)

import { headers, cookies } from 'next/headers';
import type { NextRequest } from 'next/server';

const TENANT_COOKIE = 'tenantId';
const TENANT_HEADER = 'x-tenant';

/** Lee tenantId priorizando params; si no, headers/cookie/host. */
export function currentTenantIdServer(params?: { tenantId?: string | null }): string | null {
  // 1) Ruta (más confiable en /:tenantId/app/...)
  if (params?.tenantId) return sanitize(params.tenantId);

  // 2) Header inyectado por middleware (opcional)
  const h = headers();
  const fromHeader = hget(h, TENANT_HEADER);
  if (fromHeader) return sanitize(fromHeader);

  // 3) Cookie (middleware la puede setear)
  const cookieStore = cookies();
  const c = cget(cookieStore, TENANT_COOKIE);
  if (c) return sanitize(c);

  // 4) Subdominio (fallback)
  const host = hget(h, 'host') ?? hget(h, 'x-forwarded-host') ?? '';
  const sub = firstLabel(host);
  if (sub && !['www', 'app', 'site'].includes(sub)) return sanitize(sub);

  return null;
}

/** Para API routes / Server Actions con NextRequest en mano. */
export function resolveTenantFromRequest(req: NextRequest): string | null {
  // 1) Header del middleware
  const fromHeader = hget(req.headers as any, TENANT_HEADER);
  if (fromHeader) return sanitize(fromHeader);

  // 2) Cookie
  const cookie = reqCookieGet(req, TENANT_COOKIE);
  if (cookie) return sanitize(cookie);

  // 3) Subdominio
  const host = hget(req.headers as any, 'host') ?? hget(req.headers as any, 'x-forwarded-host') ?? '';
  const sub = firstLabel(host);
  if (sub && !['www', 'app', 'site'].includes(sub)) return sanitize(sub);

  return null;
}

/** Lanza error claro si falta tenant. Útil en loaders/actions. */
export function requireTenantId(tenantId: string | null | undefined, where = 'server'): string {
  if (!tenantId) {
    throw new Error(`[PhaseC] Missing tenantId in ${where}. Ensure layout and middleware are set.`);
  }
  return tenantId;
}

// ---------- Helpers de compatibilidad ----------

/** Lectura de header compatible (Headers, ReadonlyHeaders, o record plano). */
function hget(h: any, name: string): string | null {
  if (!h) return null;
  try {
    if (typeof h.get === 'function') {
      const v = h.get(name);
      return v ?? null;
    }
    // fallback muy defensivo
    const lower = name.toLowerCase();
    if (typeof h[lower] === 'string') return h[lower] as string;
    if (h.headers && typeof h.headers[lower] === 'string') return h.headers[lower];
  } catch {}
  return null;
}

/** Normaliza valor de cookie desde cookies() (RequestCookies o similares). */
function cget(cookieStore: any, name: string): string | null {
  if (!cookieStore || typeof cookieStore.get !== 'function') return null;
  const raw = cookieStore.get(name);
  return normalizeCookieValue(raw);
}

/** Normaliza valor de cookie desde NextRequest (API cambia entre versiones). */
function reqCookieGet(req: NextRequest, name: string): string | null {
  const anyReq = req as any;
  // Next 13/14: req.cookies.get(name) -> { name, value } | undefined
  // Otras variantes: string | undefined
  if (anyReq?.cookies && typeof anyReq.cookies.get === 'function') {
    const raw = anyReq.cookies.get(name);
    return normalizeCookieValue(raw);
  }
  return null;
}

function normalizeCookieValue(raw: any): string | null {
  if (!raw) return null;
  if (typeof raw === 'string') return raw;
  if (typeof raw?.value === 'string') return raw.value;
  return null;
}

// ---------- internos ----------
function firstLabel(host: string): string | null {
  const clean = (host || '').split(':')[0]; // quita :port
  const parts = (clean || '').split('.').filter(Boolean);
  if (parts.length <= 2) return parts.length === 2 ? parts[0] : null; // ej: foo.com->null; a.b.com->a
  return parts[0]; // a.b.c.com -> a
}
function sanitize(s: string): string {
  return String(s).trim().replace(/[^a-zA-Z0-9-_]/g, '');
}
