// src/app/(tenant)/[tenantId]/app/cart-new/page.tsx
'use client';

import CartViewNew from '@/app/(tenant)/[tenantId]/components/cart-new/CartViewNew';
import { NewCartProvider } from '@/lib/newcart/context';

export default function CartNewPage() {
  return (
    <NewCartProvider>
      <div className="container py-4">
        <h1 className="h4 mb-3">Cart</h1>
        <CartViewNew />
      </div>
    </NewCartProvider>
  );
}
