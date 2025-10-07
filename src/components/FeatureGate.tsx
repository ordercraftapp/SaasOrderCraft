'use client';
import React, { useEffect, useState } from 'react';
import { useTenantId } from '@/lib/tenant/context';

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
        const r = await fetch(`/api/tenant/feature?name=${encodeURIComponent(name)}`, { cache: 'no-store' });
        const j = await r.json();
        if (active) setAllowed(!!j.allowed);
      } catch {
        if (active) setAllowed(false);
      }
    }
    run();
    return () => { active = false; };
  }, [tenantId, name]);

  if (allowed === null) return null; // o un skeleton
  return allowed ? <>{children}</> : <>{fallback}</>;
}
