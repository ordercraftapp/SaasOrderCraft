'use client';
import React, { createContext, useContext } from 'react';
import { useParams } from 'next/navigation';

const TenantCtx = createContext<string | null>(null);

export function TenantProvider({ children }: { children: React.ReactNode }) {
  const params = useParams();
  const tenantId = (params?.tenantId as string) || null;
  return <TenantCtx.Provider value={tenantId}>{children}</TenantCtx.Provider>;
}

export function useTenantId() {
  const v = useContext(TenantCtx);
  if (!v) {
    // opcional: puedes no lanzar error y retornar null
    // throw new Error('TenantId not found in context');
  }
  return v;
}
