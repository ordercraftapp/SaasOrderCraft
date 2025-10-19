// Hooks para Client Components (Web SDK)

'use client';

import { useEffect, useMemo, useState } from 'react';
import { doc, getFirestore, onSnapshot } from 'firebase/firestore';
import { coercePlan, hasFeature } from './features';
import type { FeatureKey, TenantPlanDoc } from './types';
import { useTenantId } from '@/lib/tenant/context';

/**
 * Lee el plan del tenant en tiempo real desde Firestore (client).
 * Fuente única: tenants/{tenantId} (campo "features" como array o mapa + planTier/plan)
 */
export function useTenantPlan(): {
  plan: TenantPlanDoc | null;
  loading: boolean;
  error?: string;
} {
  const tenantId = useTenantId();
  const [plan, setPlan] = useState<TenantPlanDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | undefined>();

  useEffect(() => {
    if (!tenantId) {
      setPlan(null);
      setLoading(false);
      setErr(undefined);
      return;
    }

    const db = getFirestore();
    const refTenantRoot = doc(db, 'tenants', tenantId);

    setLoading(true);
    setErr(undefined);

    const unsub = onSnapshot(
      refTenantRoot,
      (snap) => {
        const data = snap.exists() ? (snap.data() as any) : undefined;
        if (data && (data.features || data.planTier || data.plan)) {
          setPlan(
            coercePlan({
              ...data,
              // acepta planTier o plan (legado)
              planTier: data.planTier ?? data.plan,
              tenantId,
            })
          );
        } else {
          setPlan(null);
        }
        setLoading(false);
      },
      (e) => {
        setErr(e?.message ?? 'plan_listen_error');
        setLoading(false);
      }
    );

    return () => unsub();
  }, [tenantId]);

  return { plan, loading, error: err };
}

/** Verifica una feature puntual. */
export function useFeature(feature: FeatureKey): { allowed: boolean; loading: boolean } {
  const { plan, loading } = useTenantPlan();
  const allowed = useMemo(() => (plan ? hasFeature(plan, feature) : false), [plan, feature]);
  return { allowed, loading };
}
