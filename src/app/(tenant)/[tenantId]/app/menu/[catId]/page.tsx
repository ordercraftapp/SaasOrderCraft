// src/app/(tenant)/[tenantId]/app/menu/[catId]/page.tsx
import CategoryClient from './CategoryClient';

type Params = { catId: string };

export default async function CategoryPage({
  params,
}: {
  params: Params | Promise<Params>;
}) {
  // Compat: Next 14 (obj) y Next 15 (Promise)
  const { catId } =
    typeof (params as any)?.then === 'function'
      ? await (params as Promise<Params>)
      : (params as Params);

  return <CategoryClient catId={catId} />;
}
