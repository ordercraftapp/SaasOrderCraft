// src/app/(tenant)/[tenant]/app/(client)/layout.tsx
'use client';

import type { ReactNode } from 'react';
import Protected from '@/app/(tenant)/[tenantId]/components/Protected'; // exige sesión iniciada

export default function ClientAreaLayout({ children }: { children: ReactNode }) {
  // 🔐 Todas las rutas dentro de (client) requieren login (cualquier usuario autenticado).
  //    El scoping a tenant viene por la ruta /[tenant]/app/(client)/...
  return <Protected>{children}</Protected>;
}
