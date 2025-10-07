// src/app/(tenant)/[tenantId]/app/layout.tsx
import 'bootstrap/dist/css/bootstrap.min.css';
import BootstrapClient from '@/components/BootstrapClient';
import { TenantProvider } from '@/lib/tenant/context'; // PhaseC ✅

export default function TenantAppLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { tenantId?: string };
}) {
  const tenantId = params?.tenantId ?? null; // PhaseC ✅

  return (
    <html lang="es">
      <body>
        <BootstrapClient /> {/* JS de Bootstrap para dropdowns/modals */}
        <TenantProvider tenantId={tenantId}>
          {children}
        </TenantProvider>
      </body>
    </html>
  );
}
