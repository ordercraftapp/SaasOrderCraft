// src/app/(tenant)/[tenantId]/app/menu/[catId]/[subId]/page.tsx
import SubcategoryClient from './SubcategoryClient';

type Params = { catId: string; subId: string };

export default async function SubcategoryPage({
  params,
}: {
  params: Params | Promise<Params>;
}) {
  // Compat: Next 14 (obj) y Next 15 (Promise)
  const { catId, subId } =
    typeof (params as any)?.then === 'function'
      ? await (params as Promise<Params>)
      : (params as Params);

  return <SubcategoryClient catId={catId} subId={subId} />;
}
