// src/lib/tenant/context.tsx
// PhaseC — TenantProvider + hook cliente

'use client';

import React, { createContext, useContext, useMemo } from 'react';

type TenantContextValue = { tenantId: string | null };

const TenantContext = createContext<TenantContextValue | undefined>(undefined);

export function TenantProvider({
  tenantId,
  children,
}: {
  tenantId: string | null | undefined;
  children: React.ReactNode;
}) {
  const value = useMemo(() => ({ tenantId: tenantId ?? null }), [tenantId]);
  return <TenantContext.Provider value={value}>{children}</TenantContext.Provider>;
}

export function useTenantId(): string | null {
  const ctx = useContext(TenantContext);
  if (!ctx) {
    // Nota: no rompemos el render; devolvemos null y logueamos
    if (process.env.NODE_ENV !== 'production') {
      console.warn('[PhaseC] useTenantId() used outside <TenantProvider>. Returning null.');
    }
    return null;
  }
  return ctx.tenantId;
}
