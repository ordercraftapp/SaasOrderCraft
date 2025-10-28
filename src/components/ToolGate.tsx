// Wrapper de UI para mostrar/ocultar tools según el plan (Client Component)

'use client';

import React, { useMemo } from 'react';
import { useFeature } from '@/lib/plans/client';
import type { FeatureKey } from '@/lib/plans/types';

type Props = {
  feature: FeatureKey;
  children: React.ReactNode;
  fallback?: React.ReactNode;
};

/* Helpers para resolver tenantId y armar URL del site /upgrade */
function getTenantIdFromLocationSafe(): string | null {
  try {
    if (typeof window === 'undefined') return null;

    const pathname = window.location.pathname || '/';
    const parts = pathname.split('/').filter(Boolean);

    // 1) /{tenantId}/app/...
    if (parts.length >= 2 && parts[1] === 'app') {
      return parts[0] || null;
    }
    // 2) /_t/{tenantId}/app/...
    if (parts.length >= 3 && parts[0] === '_t' && parts[2] === 'app') {
      return parts[1] || null;
    }

    // 3) Subdominio: {tenantId}.base.domain/...
    const host = window.location.hostname || '';
    const labels = host.split('.').filter(Boolean);
    if (labels.length >= 3 && labels[0] !== 'www') return labels[0];

    return null;
  } catch {
    return null;
  }
}

function buildUpgradeUrl(tenantId?: string | null): string | null {
  try {
    const baseDomain = (process.env.NEXT_PUBLIC_BASE_DOMAIN || 'datacraftcoders.cloud').toLowerCase();
    const url = new URL(`https://${baseDomain}/upgrade`);
    if (tenantId) url.searchParams.set('tenantId', tenantId);
    return url.toString();
  } catch {
    return null;
  }
}

export default function ToolGate({ feature, children, fallback }: Props) {
  const feat = useFeature(feature) as { allowed: boolean; loading: boolean; tenantId?: string };

  // ✅ Calcula siempre los hooks (nunca condicional)
  const resolvedTenantId = useMemo(
    () => feat?.tenantId ?? getTenantIdFromLocationSafe(),
    [feat?.tenantId]
  );
  const upgradeHref = useMemo(
    () => buildUpgradeUrl(resolvedTenantId),
    [resolvedTenantId]
  );

  if (feat.loading) return <div className="text-muted">Loading…</div>;

  if (!feat.allowed) {
    if (process.env.NODE_ENV !== 'production') {
      console.warn(`[ToolGate] feature "${String(feature)}" disabled for tenant ${feat.tenantId ?? '(unknown)'}`);
    }

    // Si el caller provee fallback, lo respetamos (retrocompat).
    if (fallback) return <>{fallback}</>;

    return (
      <div className="alert alert-warning d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-2">
        <div>
          <strong>This tool is not available</strong> on your current plan.
          <span className="ms-1 text-muted">Unlock it by upgrading.</span>
        </div>
        {upgradeHref ? (
          <a
            href={upgradeHref}
            className="btn btn-warning btn-sm fw-semibold position-relative"
            style={{ boxShadow: '0 0 0.65rem rgba(255,193,7,.45)' }}
            rel="noopener noreferrer"
          >
            <span className="me-1" aria-hidden>✨</span>
            Upgrade plan
            <span
              className="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger"
              style={{ fontSize: '0.65rem' }}
            >
              NEW
              <span className="visually-hidden">new</span>
            </span>
          </a>
        ) : null}
      </div>
    );
  }

  return <>{children}</>;
}
