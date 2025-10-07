// src/app/(tenant)/[tenantId]/app/layout.tsx
import 'bootstrap/dist/css/bootstrap.min.css';
import BootstrapClient from '@/components/BootstrapClient';

export default function TenantAppLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <BootstrapClient /> {/* JS de Bootstrap para dropdowns/modals */}
        {children}
      </body>
    </html>
  );
}
