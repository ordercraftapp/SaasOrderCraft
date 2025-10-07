// src/lib/tenant/features.ts
// PhaseC — Guards de features por plan (server-only)

import { getFirestore, doc, getDoc /* , collection, getDocs */ } from 'firebase/firestore';
import '@/lib/firebase/client'; // asegura init
import { currentTenantIdServer, requireTenantId } from '@/lib/tenant/server';

type FeatureName =
  | 'marketing'
  | 'advanced-reports'
  | 'delivery-module'
  | 'coupons'
  | 'multi-branch'
  | string;

type TenantDoc = {
  planId?: string | null;
  features?: Record<string, boolean>;
  // ...otros campos de tu tenant
};

// --------- Caché en memoria básica (revalida cada 60s) ---------
const __featureCache = new Map<string, { expiresAt: number; features: Record<string, boolean> }>();
const TTL_MS = 60_000;

async function fetchTenantFeatures(tenantId: string): Promise<Record<string, boolean>> {
  const now = Date.now();
  const cached = __featureCache.get(tenantId);
  if (cached && cached.expiresAt > now) return cached.features;

  const db = getFirestore();

  // Opción A: todo en el doc tenant raíz
  const ref = doc(db, 'tenants', tenantId);
  const snap = await getDoc(ref);
  const data = (snap.exists() ? (snap.data() as TenantDoc) : null) || {};

  // Opción B (alternativa): doc de settings (descomenta si lo usas)
  // const sref = doc(db, 'tenants', tenantId, 'settings', 'plan');
  // const ssnap = await getDoc(sref);
  // const sdata = (ssnap.exists() ? (ssnap.data() as { features?: Record<string, boolean> }) : null) || {};

  const features: Record<string, boolean> = {
    // defaults seguros
    marketing: false,
    'advanced-reports': false,
    'delivery-module': true, // si quieres habilitado por defecto, ajusta
    coupons: false,
    'multi-branch': false,
    // merge con lo que venga del doc:
    ...(data.features || {}),
    // ...(sdata.features || {}),
  };

  __featureCache.set(tenantId, { expiresAt: now + TTL_MS, features });
  return features;
}

/** Devuelve true/false para un feature. */
export async function hasFeature(tenantId: string, feature: FeatureName): Promise<boolean> {
  const features = await fetchTenantFeatures(tenantId);
  return Boolean(features[feature]);
}

/** Lanza error 403 si el feature no está activo. */
export async function requireFeature(
  tenantId: string | null | undefined,
  feature: FeatureName,
  where = 'server'
): Promise<void> {
  const tid = requireTenantId(tenantId, where);
  const ok = await hasFeature(tid, feature);
  if (!ok) {
    const msg = `[PhaseC] Feature "${feature}" is not enabled for tenant "${tid}" (${where}).`;
    // Puedes lanzar error, o devolver redirect en las páginas (ver ejemplo abajo)
    const err = new Error(msg);
    (err as any).status = 403;
    throw err;
  }
}

/** Azúcar para Server Actions (sin params) o loaders que no pasan params. */
export async function requireFeatureFromContext(
  feature: FeatureName,
  where = 'server'
): Promise<void> {
  const tid = currentTenantIdServer();
  await requireFeature(tid, feature, where);
}
