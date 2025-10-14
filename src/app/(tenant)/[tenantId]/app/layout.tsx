// src/app/(tenant)/[tenantId]/layout.tsx (o el TenantAppLayout que uses)
import 'bootstrap/dist/css/bootstrap.min.css';
import BootstrapClient from '@/app/(tenant)/[tenantId]/components/BootstrapClient';
import { TenantProvider } from '@/lib/tenant/context';
import Providers from '@/app/providers';
import { NewCartProvider } from '@/lib/newcart/context'; // 👈 aquí

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
        <NewCartProvider> {/* 👈 ahora todo el portal (menu, cart, etc.) tiene carrito */}
          {children}
        </NewCartProvider>
      </TenantProvider>
    </Providers>
  );
}
