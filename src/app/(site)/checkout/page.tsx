// src/app/(site)/checkout/page.tsx
export const dynamic = 'force-dynamic';

import CheckoutClient from './CheckoutClient';

export default function CheckoutPage({
  searchParams,
}: {
  searchParams: { tenantId?: string; orderId?: string };
}) {
  const tenantId = String(searchParams?.tenantId || '');
  const orderId  = String(searchParams?.orderId  || '');

  return (
    <main className="container py-5">
      <CheckoutClient tenantId={tenantId} orderId={orderId} />
    </main>
  );
}
