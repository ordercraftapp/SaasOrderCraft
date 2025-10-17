// Wrapper de UI para mostrar/ocultar tools según el plan (Client Component)

'use client';

import React from 'react';
import { useFeature } from '@/lib/plans/client';
import type { FeatureKey } from '@/lib/plans/types';

type Props = {
  feature: FeatureKey;
  children: React.ReactNode;
  fallback?: React.ReactNode;
};

export default function ToolGate({ feature, children, fallback }: Props) {
  const feat = useFeature(feature) as { allowed: boolean; loading: boolean; tenantId?: string };

  if (feat.loading) return <div className="text-muted">Loading…</div>;

  if (!feat.allowed) {
    if (process.env.NODE_ENV !== 'production') {
      // 👇 Traza útil en dev para depurar por qué no aparece una tool
      console.warn(`[ToolGate] feature "${String(feature)}" disabled for tenant ${feat.tenantId ?? '(unknown)'}`);
    }
    return (
      fallback ?? (
        <div className="alert alert-warning">
          This tool is not available on your current plan.{' '}
          <a className="alert-link" href="/app/admin/billing">
            Upgrade plan
          </a>
          .
        </div>
      )
    );
  }

  return <>{children}</>;
}
