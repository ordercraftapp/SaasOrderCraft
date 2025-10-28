export const dynamic = 'force-dynamic';

import UpgradeClient from './UpgradeClient';

export default function UpgradePage({
  searchParams,
}: {
  searchParams: { tenantId?: string; orderId?: string };
}) {
  const tenantId = String(searchParams?.tenantId || '');
  const orderId  = String(searchParams?.orderId  || '');

  return (
    <main className="container py-5">
      <UpgradeClient tenantId={tenantId} orderId={orderId} />
    </main>
  );
}
