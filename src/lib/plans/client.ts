// Hooks para Client Components (Web SDK)

'use client';

import { useEffect, useMemo, useState } from 'react';
import { doc, getFirestore, onSnapshot } from 'firebase/firestore';
import { tDoc } from '@/lib/db';
import { coercePlan, hasFeature } from './features';
import type { FeatureKey, TenantPlanDoc } from './types';
import { useTenantId } from '@/lib/tenant/context';

/**
 * Lee el plan del tenant en tiempo real desde Firestore (client).
 * - Preferencia: tenants/{tenantId}/system_flags/plan
 * - Fallback:    tenants/{tenantId} (campo "features" como array o mapa)
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

    // 1) Suscripción principal: tenants/{tenantId}/system_flags/plan
    const refPlan = tDoc('system_flags', tenantId, 'plan');

    // 2) Fallback: doc raíz tenants/{tenantId}
    const refTenantRoot = doc(db, 'tenants', tenantId);

    let gotPrimaryOnce = false;
    let unsubPrimary: (() => void) | null = null;
    let unsubFallback: (() => void) | null = null;
    setLoading(true);
    setErr(undefined);

    // Fallback primero, así tenemos algo si el primary no existe
    unsubFallback = onSnapshot(
      refTenantRoot,
      (snap) => {
        if (gotPrimaryOnce) return; // si ya obtuvimos primary válido, ignoramos fallback
        const data = snap.exists() ? (snap.data() as any) : undefined;
        // Solo intentamos coerce si hay "features" o "planTier" en el root
        if (data && (data.features || data.planTier)) {
          setPlan(coercePlan({ planTier: data.planTier, features: data.features, createdAt: data.createdAt, updatedAt: data.updatedAt, tenantId }));
          setLoading(false);
        }
      },
      (e) => {
        if (!gotPrimaryOnce) {
          setErr(e?.message ?? 'plan_listen_error_fallback');
          setLoading(false);
        }
      }
    );

    // Primary (preferido)
    unsubPrimary = onSnapshot(
      refPlan,
      (snap) => {
        gotPrimaryOnce = true;
        const data = snap.exists() ? (snap.data() as Partial<TenantPlanDoc>) : undefined;
        setPlan(coercePlan(data));
        setLoading(false);
      },
      (e) => {
        // Si falla primary pero fallback ya dio algo, mantenemos lo del fallback
        setErr(e?.message ?? 'plan_listen_error');
        setLoading(false);
      }
    );

    return () => {
      if (unsubPrimary) unsubPrimary();
      if (unsubFallback) unsubFallback();
    };
  }, [tenantId]);

  return { plan, loading, error: err };
}

/** Verifica una feature puntual. */
export function useFeature(feature: FeatureKey): { allowed: boolean; loading: boolean } {
  const { plan, loading } = useTenantPlan();
  const allowed = useMemo(() => (plan ? hasFeature(plan, feature) : false), [plan, feature]);
  return { allowed, loading };
}
