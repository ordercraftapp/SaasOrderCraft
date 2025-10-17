// src/app/(tenant)/[tenantId]/app/layout.tsx
import 'bootstrap/dist/css/bootstrap.min.css';
import BootstrapClient from '@/app/(tenant)/[tenantId]/components/BootstrapClient';
import { TenantProvider } from '@/lib/tenant/context';
import Providers from '@/app/(tenant)/[tenantId]/app/providers';
import { NewCartProvider } from '@/lib/newcart/context';

// ⬇️ NUEVO
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
        {/* ⬇️ NUEVO: asegura cookies de rol (appRole/isOp) para el tenant actual */}
        <RefreshRoleBootstrap />
        <NewCartProvider>
          {children}
        </NewCartProvider>
      </TenantProvider>
    </Providers>
  );
}
