// src/lib/tenant/resolve.ts
/**
 * Helpers para resolver tenantId en Server (Route Handlers / Server Components).
 * Orden de resolución:
 * 1) params.tenantId  (por rutas: /app/(tenant)/[tenantId]/...)
 * 2) header: x-tenant-id
 * 3) pathname con prefijo /_t/{tenantId}/...
 * 4) subdominio del host (tenant.example.com)
 */

type MaybeParams = { tenantId?: string } | Record<string, any> | undefined;

/** Si usas el patrón /_t/{tenantId}/... en reescrituras */
export function getTenantIdFromPath(pathname: string): string | null {
  if (!pathname) return null;
  const parts = pathname.split('/').filter(Boolean); // ej: ['_t','abc','app','...']
  if (parts[0] === '_t' && parts[1]) return parts[1];
  return null;
}

/** Intenta leer el subdominio como tenantId: tenant.domain.tld */
export function getTenantIdFromSubdomain(hostname: string | null): string | null {
  if (!hostname) return null;
  // Elimina puerto si viene como host:port
  const host = hostname.split(':')[0].toLowerCase();

  // Ignora localhost o hosts sin subdominio claro
  // - localhost, 127.0.0.1 → null
  if (host === 'localhost' || host === '127.0.0.1') return null;

  const labels = host.split('.');
  // Mínimo 3 labels para considerar subdominio: foo.domain.tld
  if (labels.length < 3) return null;

  const first = labels[0];
  if (!first || first === 'www') return null;
  return first;
}

/**
 * Resolver principal usado por tus APIs:
 * - req: Request (NextRequest es compatible)
 * - params: { tenantId?: string } de la ruta
 */
export function resolveTenantFromRequest(req: Request, params?: MaybeParams): string | null {
  // 1) params.[tenantId] (ruta: /[tenantId]/...)
  const fromParams = params && typeof params === 'object' ? (params as any).tenantId : null;
  if (fromParams) return String(fromParams);

  // 2) header x-tenant-id
  const hTenant = req.headers.get('x-tenant-id');
  if (hTenant) return hTenant.trim();

  // 3) path reescrito /_t/{tenantId}/...
  try {
    const url = new URL(req.url);
    const fromPath = getTenantIdFromPath(url.pathname);
    if (fromPath) return fromPath;

    // 4) subdominio
    const fromSub = getTenantIdFromSubdomain(url.hostname);
    if (fromSub) return fromSub;
  } catch {
    // ignora
  }

  return null;
}

/** Útil en Server Components si expones next/headers con x-tenant-id o next-url */
export function currentTenantIdFromHeaders(): string | null {
  // Nota: en Server Components puedes usar:
  //   import { headers } from 'next/headers';
  // y luego leer 'x-tenant-id' o 'next-url'
  // Lo dejamos como placeholder para no importar next/headers aquí.
  return null;
}
