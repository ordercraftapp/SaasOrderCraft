import 'bootstrap/dist/css/bootstrap.min.css';
import BootstrapClient from '@/components/BootstrapClient';

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <BootstrapClient />
        {children}
      </body>
    </html>
  );
}