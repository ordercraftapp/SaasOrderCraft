// src/app/(tenant)/[tenantId]/components/FeatureGate.tsx
'use client';
import React, { useEffect, useState } from 'react';
import { useTenantId } from '@/lib/tenant/context';
import { tenantPath } from '@/lib/tenant/paths';

export default function FeatureGate({
  name,
  fallback = null,
  children,
}: {
  name: string;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}) {
  const tenantId = useTenantId();
  const [allowed, setAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    let active = true;
    async function run() {
      if (!tenantId) { setAllowed(false); return; }
      try {
        const q = new URLSearchParams({ name, tenantId }); // opcional: tenantId explícito
        const path = `/app/api/tenant/feature?${q.toString()}`;
        const url = tenantId
          ? tenantPath(tenantId, path)    // wildcard → /app/api/tenant/feature?... | local → /{tenant}/app/api/tenant/feature?...
          : `/api/tenant/feature?${q.toString()}`; // fallback (site)
        const r = await fetch(url, { cache: 'no-store' });
        const j = await r.json();
        if (active) setAllowed(!!j.allowed);
      } catch {
        if (active) setAllowed(false);
      }
    }
    run();
    return () => { active = false; };
  }, [tenantId, name]);

  if (allowed === null) return null; // puedes poner un skeleton si quieres
  return allowed ? <>{children}</> : <>{fallback}</>;
}
