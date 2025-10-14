import 'bootstrap/dist/css/bootstrap.min.css';
import BootstrapClient from '@/app/(tenant)/[tenantId]/components/BootstrapClient';
import { TenantProvider } from '@/lib/tenant/context';
// ⬇️ Asegura contextos de Auth/Cart en todo el subtree
import Providers from '@/app/providers';
import { NewCartProvider } from '@/lib/newcart/context'; // 👈 añadido

export default function TenantAppLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { tenantId: string };
}) {
  // Si necesitas el tenantId aquí para algo futuro, lo tienes:
  // const tenantId = params.tenantId; <TenantProvider> </TenantProvider>

  return (
    <Providers>
      <BootstrapClient />
      <TenantProvider>
        <NewCartProvider> {/* 👈 añadido */}
          {children}
        </NewCartProvider> {/* 👈 añadido */}
      </TenantProvider>
    </Providers>
  );
}
