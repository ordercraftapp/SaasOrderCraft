// src/app/(site)/layout.tsx
import 'bootstrap/dist/css/bootstrap.min.css';

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
