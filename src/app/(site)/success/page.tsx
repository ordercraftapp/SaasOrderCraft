// src/app/(site)/success/page.tsx
export const dynamic = 'force-dynamic';

import SuccessClient from './SuccessClient';

export default function SuccessPage({
  searchParams,
}: {
  searchParams: { tenantId?: string };
}) {
  const tenantId = String(searchParams?.tenantId || '').toLowerCase();

  return (
    <SuccessClient tenantId={tenantId} />
  );
}
