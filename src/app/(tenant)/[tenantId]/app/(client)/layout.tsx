// src/app/(tenant)/[tenant]/app/(client)/layout.tsx
'use client';

import type { ReactNode } from 'react';
// ✅ Importa desde el mismo segmento [tenant]
import Protected from '@/app/(tenant)/[tenantId]/components/Protected';

export default function ClientAreaLayout({ children }: { children: ReactNode }) {
  // 🔐 Todas las rutas dentro de (client) requieren login (cualquier usuario autenticado).
  //    El scoping a tenant viene por la ruta /[tenant]/app/(client)/...
  //    Activa redirect para enviar a /login cuando no hay sesión.
  return <Protected redirect>{children}</Protected>;
}
