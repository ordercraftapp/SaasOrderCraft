'use client';

import Link from 'next/link';
import { useNewCart } from '@/lib/newcart/context';
import { useMemo } from 'react';

export default function CartIconNew() {
  const cart = useNewCart();
  const count = useMemo(
    () => cart.items.reduce((acc, it) => acc + (it.quantity || 1), 0),
    [cart.items]
  );

  return (
    <Link href="/cart-new" className="position-relative d-inline-flex align-items-center text-decoration-none">
      {/* Ícono simple con Bootstrap; sustituye por tu SVG/ícono si deseas */}
      <span className="me-1">🛒</span>
      <span>Cart</span>

      {count > 0 && (
        <span
          className="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger"
          style={{ fontSize: '0.65rem' }}
          aria-label={`Tienes ${count} items en el carrito`}
        >
          {count}
        </span>
      )}
    </Link>
  );
}
