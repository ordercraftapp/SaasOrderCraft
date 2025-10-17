// Wrapper de UI para mostrar/ocultar tools según el plan (Client Component)

'use client';

import React from 'react';
import { useFeature } from '@/lib/plans/client';
import type { FeatureKey } from '@/lib/plans/types';

export default function ToolGate({
  feature,
  children,
  fallback,
}: {
  feature: FeatureKey;
  children: React.ReactNode;
  fallback?: React.ReactNode;
}) {
  const { allowed, loading } = useFeature(feature);

  if (loading) return <div className="text-muted">Loading…</div>;
  if (!allowed) {
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
