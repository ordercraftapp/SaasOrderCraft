import 'bootstrap/dist/css/bootstrap.min.css';
import SuperAdminOnly from './components/SuperAdminOnly';

export default function SuperadminLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>
        <SuperAdminOnly>
          {children}
        </SuperAdminOnly>
      </body>
    </html>
  );
}
