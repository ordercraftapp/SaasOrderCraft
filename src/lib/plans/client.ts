// src/lib/plans/client.ts
// Hooks para Client Components (Web SDK)

'use client';

import { useEffect, useMemo, useState } from 'react';
import { onSnapshot } from 'firebase/firestore';
import { tDoc } from '@/lib/db';
import { coercePlan, hasFeature } from './features';
import type { FeatureKey, TenantPlanDoc } from './types';
import { useTenantId } from '@/lib/tenant/context';

/** Lee el plan del tenant en tiempo real desde Firestore (client). */
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
      return;
    }

    // ✅ Helper tenant-aware: tenants/{tenantId}/system_flags/plan
    const ref = tDoc('system_flags', tenantId, 'plan');

    const unsub = onSnapshot(
      ref,
      (snap) => {
        setPlan(coercePlan(snap.exists() ? (snap.data() as Partial<TenantPlanDoc>) : undefined));
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
