export const metadata = { title: "OrderCraft", description: "Multi-tenant SaaS" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es"><body>{children}</body></html>
  );
}
