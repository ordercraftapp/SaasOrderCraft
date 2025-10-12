// src/app/(tenant)/[tenantId]/app/menu/layout.tsx
import type { ReactNode } from 'react';
import ClientAppLayout from '@/app/(tenant)/[tenantId]/app/(client)/app/layout';
// import { adminDb } from '@/lib/firebase/admin'; // ⬅️ viejo: comentar
import { getAdminDB } from '@/lib/firebase/admin';   // ⬅️ nuevo
import { currentTenantIdServer, requireTenantId } from '@/lib/tenant/server';

// Lee idioma del tenant: tenants/{tenantId}/settings/general.language
async function getUiLanguage(tenantId: string): Promise<string> {
  try {
    const db = getAdminDB(); // ⬅️ usar instancia al vuelo
    const snap = await db.doc(`tenants/${tenantId}/settings/general`).get();
    const lang = (snap.exists && (snap.data() as any)?.language) || 'es';
    return typeof lang === 'string' ? lang : 'es';
  } catch {
    return 'es';
  }
}

export default async function MenuLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: { tenantId: string };
}) {
  const tenantId = requireTenantId(currentTenantIdServer(params), 'layout:menu');
  const serverLang = await getUiLanguage(tenantId);

  return <ClientAppLayout serverLang={serverLang}>{children}</ClientAppLayout>;
}
