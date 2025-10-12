import 'bootstrap/dist/css/bootstrap.min.css';
import BootstrapClient from '@/app/(tenant)/[tenantId]/components/BootstrapClient';
// ⬇️ antes: import { TenantProvider } from '@/lib/tenant/context';
import { TenantProvider } from '@/lib/tenant/context';

export default function TenantAppLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { tenantId: string };
}) {
  const tenantId = params.tenantId; // ya es string

  return (
    <html lang="es">
      <body>
        <BootstrapClient />
        <TenantProvider>
          {children}
        </TenantProvider>
      </body>
    </html>
  );
}
