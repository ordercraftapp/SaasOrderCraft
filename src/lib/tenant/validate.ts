// src/lib/tenant/validate.ts

const RESERVED = new Set([
  'www', 'site', 'app', 'admin', 'api', 'static', 'assets', 'images',
  'img', 'cdn', 'mail', 'smtp', 'imap', 'pop', 'ftp',
  'test', 'demo', 'staging', 'localhost',
]);

/** Devuelve un slug DNS-safe: minúsculas, [a-z0-9-], sin comenzar/terminar en '-' */
export function normalizeTenantId(input: string): string {
  const s = String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')       // solo letras, números y '-'
    .replace(/-+/g, '-')               // colapsa '--' a '-'
    .replace(/^-+/, '')                // sin guiones al inicio
    .replace(/-+$/, '');               // sin guiones al final
  return s.slice(0, 63);               // DNS label máx 63 chars
}

/** Valida reglas DNS + reservados. Lanza error con mensaje claro. */
export function assertValidTenantId(tenantId: string) {
  if (!tenantId) throw new Error('Please enter a subdomain.');
  if (tenantId.length < 3) throw new Error('Subdomain must be at least 3 characters.');
  if (tenantId.length > 63) throw new Error('Subdomain cannot exceed 63 characters.');
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(tenantId)) {
    throw new Error('Use only lowercase letters, numbers, and hyphens (no leading/trailing hyphen).');
  }
  if (RESERVED.has(tenantId)) {
    throw new Error('This subdomain is reserved. Please choose another.');
  }
}
