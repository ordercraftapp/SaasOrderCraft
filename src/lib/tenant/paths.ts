// src/lib/tenant/paths.ts
export function tenantPath(tenantId: string, path: string) {
  const supportsWildcard =
    process.env.NEXT_PUBLIC_USE_WILDCARD_SUBDOMAINS?.toLowerCase() !== 'false';
  // path debe empezar con '/'
  const p = path.startsWith('/') ? path : `/app/${path}`;
  return supportsWildcard ? p : `/${tenantId}${p}`;
}
