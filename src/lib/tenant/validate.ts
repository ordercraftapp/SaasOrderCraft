// src/lib/tenant/validate.ts

// Lista de subdominios reservados (coincide con las APIs y reglas)
const RESERVED = new Set([
  'www', 'site', 'app', 'admin', 'api',
  'static', 'assets', 'images', 'img', 'cdn',
  'mail', 'smtp', 'imap', 'pop', 'ftp',
  'test', 'demo', 'staging', 'localhost',
  'root', 'support', 'status',
]);

const MAX_LABEL_LENGTH = 63;

/** Devuelve un slug DNS-safe: minúsculas, [a-z0-9-], sin comenzar/terminar en '-' */
export function normalizeTenantId(input: string): string {
  const s = String(input || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')   // todo lo no permitido → '-'
    .replace(/-+/g, '-')           // colapsar guiones repetidos
    .replace(/^-+/, '')            // sin guion al inicio
    .replace(/-+$/, '');           // sin guion al final
  return s.slice(0, MAX_LABEL_LENGTH); // DNS label máx 63 chars
}

/** Valida reglas DNS + reservados. Lanza error con mensaje claro. */
export function assertValidTenantId(tenantId: string) {
  if (!tenantId) throw new Error('Please enter a subdomain.');
  if (tenantId.length < 3) throw new Error('Subdomain must be at least 3 characters.');
  if (tenantId.length > MAX_LABEL_LENGTH) throw new Error('Subdomain cannot exceed 63 characters.');

  // Patrón DNS: inicia con [a-z0-9], puede contener [-], termina con [a-z0-9]
  if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])$/.test(tenantId)) {
    throw new Error('Use only lowercase letters, numbers, and hyphens (no leading/trailing hyphen).');
    // opcional: mensaje en español si prefieres unificar idioma
  }

  if (RESERVED.has(tenantId)) {
    throw new Error('This subdomain is reserved. Please choose another.');
  }
}

/** Helper opcional: ¿está reservado? */
export function isReservedTenantId(tenantId: string): boolean {
  return RESERVED.has(tenantId);
}
