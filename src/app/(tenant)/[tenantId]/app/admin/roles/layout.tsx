// ESTE archivo es server (no pongas "use client")
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default function RolesLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return children;
}
