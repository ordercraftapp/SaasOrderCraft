// src/app/(tenant)/[tenantId]/app/layout.tsx
import 'bootstrap/dist/css/bootstrap.min.css';
import BootstrapClient from '@/app/(tenant)/[tenantId]/components/BootstrapClient';
import { TenantProvider } from '@/lib/tenant/context';
import Providers from '@/app/(tenant)/[tenantId]/app/providers';
import { NewCartProvider } from '@/lib/newcart/context';

// ⬇️ NUEVO: SettingsProvider (respeta currency/locale/language del tenant)
import { SettingsProvider } from '@/lib/settings/context';

// ⬇️ EXISTENTE
import RefreshRoleBootstrap from '@/app/(tenant)/[tenantId]/components/RefreshRoleBootstrap';

export default function TenantAppLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { tenantId: string };
}) {
  return (
    <Providers>
      <BootstrapClient />
      <TenantProvider>
        {/* Montamos SettingsProvider una sola vez para todo el árbol del tenant */}
        <SettingsProvider key={params.tenantId}>
          {/* Asegura cookies de rol (appRole/isOp) para el tenant actual */}
          <RefreshRoleBootstrap />
          <NewCartProvider>
            {children}
          </NewCartProvider>
        </SettingsProvider>
      </TenantProvider>
    </Providers>
  );
}
