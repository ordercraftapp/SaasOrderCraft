// src/lib/plans/server.ts
// Guardas para APIs/Server Components (Admin SDK)

import { getAdminDB } from '@/lib/firebase/admin';
import { resolveTenantFromRequest } from '@/lib/tenant/resolve';
import { coercePlan, hasFeature } from './features';
import type { FeatureKey, TenantPlanDoc } from './types';

/** Pequeño cache en memoria por 60s para evitar hits repetidos a Firestore */
const CACHE_TTL_MS = 60_000;
const planCache = new Map<string, { at: number; plan: TenantPlanDoc }>();

export function requireTenantId(v: string | null, where: string): string {
  if (!v) throw new Error(`Missing tenantId @ ${where}`);
  return v;
}

export async function fetchTenantPlanAdmin(tenantId: string): Promise<TenantPlanDoc> {
  const now = Date.now();
  const hit = planCache.get(tenantId);
  if (hit && now - hit.at < CACHE_TTL_MS) return hit.plan;

  const db = getAdminDB();
  const snap = await db.doc(`tenants/${tenantId}/system_flags/plan`).get();
  const plan = coercePlan(snap.exists ? (snap.data() as Partial<TenantPlanDoc>) : undefined);
  planCache.set(tenantId, { at: now, plan });
  return plan;
}

/**
 * Guard para APIs:
 * - Resuelve tenant desde request+params
 * - Lee el plan del tenant
 * - Verifica la feature requerida
 * Devuelve { ok:false, status:403 } si no está permitido
 */
export async function requireTenantFeature(
  req: Request,
  params: any,
  feature: FeatureKey,
  tag: string
): Promise<
  | { ok: true; tenantId: string; plan: TenantPlanDoc }
  | { ok: false; status: number; tenantId: string; plan: TenantPlanDoc }
> {
  const tenantId = requireTenantId(resolveTenantFromRequest(req, params), `api:${tag}`);
  const plan = await fetchTenantPlanAdmin(tenantId);
  if (!hasFeature(plan, feature)) {
    return { ok: false as const, status: 403, tenantId, plan };
  }
  return { ok: true as const, tenantId, plan };
}
