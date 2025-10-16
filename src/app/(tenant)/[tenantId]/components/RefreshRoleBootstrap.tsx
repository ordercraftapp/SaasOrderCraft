// src/app/(tenant)/[tenantId]/components/RefreshRoleBootstrap.tsx
'use client';

import { useEffect } from 'react';
import { getAuth, onIdTokenChanged } from 'firebase/auth';
import '@/lib/firebase/client';
import { refreshRole } from '@/lib/auth/refreshRole';
import { useTenantId } from '@/lib/tenant/context';

export default function RefreshRoleBootstrap() {
  const tenantId = useTenantId();

  useEffect(() => {
    if (!tenantId) return;

    const auth = getAuth();

    // 1) refresco inmediato al montar (si ya hay sesión)
    if (auth.currentUser) {
      refreshRole(tenantId, 'GET').catch(() => {});
    }

    // 2) refrescar si el ID token cambia (renovación, login/logout)
    const unsub = onIdTokenChanged(auth, async (user) => {
      if (user) {
        try { await refreshRole(tenantId, 'GET'); } catch {}
      }
    });

    return () => unsub();
  }, [tenantId]);

  return null;
}
