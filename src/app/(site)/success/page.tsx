// src/app/(site)/success/page.tsx
export const dynamic = 'force-dynamic';

import SuccessClient from './SuccessClient';

export default function SuccessPage({
  searchParams,
}: {
  searchParams: { tenantId?: string; orderId?: string };
}) {
  const tenantId = String(searchParams?.tenantId || '').toLowerCase();
  const orderId  = String(searchParams?.orderId  || '');

  return <SuccessClient tenantId={tenantId} orderId={orderId} />;
}
