// src/components/CartBadge.tsx
'use client';

import Link from 'next/link';
import { useMemo } from 'react';

// Nuevo carrito (opcional si existe)
let useNewCartHook: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  useNewCartHook = require('@/lib/newcart/context').useNewCart;
} catch { /* noop */ }

// Carrito legacy (opcional si existe)
let useLegacyCartHook: any = null;
try {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  useLegacyCartHook = require('@/lib/cart/context').useCart;
} catch { /* noop */ }

type Props = React.ComponentProps<'div'> & {
  /** Ruta a la que navega el ícono; por defecto usa el carrito NUEVO */
  href?: string;
  /** Si quieres mostrar también el total junto al badge */
  showTotal?: boolean;
};

function fmtQ(n?: number) {
  const v = Number.isFinite(Number(n)) ? Number(n) : 0;
  try {
    return new Intl.NumberFormat('es-GT', { style: 'currency', currency: 'USD' }).format(v);
  } catch {
    return `Q ${v.toFixed(2)}`;
  }
}

export default function CartBadge({ className, href = '/cart-new', showTotal = false, ...rest }: Props) {
  // Intentamos ambos contextos sin romper si alguno falta
  const newCart = (() => {
    try { return useNewCartHook ? useNewCartHook() : null; } catch { return null; }
  })();

  const legacyCart = (() => {
    try { return useLegacyCartHook ? useLegacyCartHook() : null; } catch { return null; }
  })();

  // Elegimos la fuente “con datos”
  const items = useMemo(() => {
    if (newCart?.items?.length) return newCart.items;
    if (legacyCart?.items?.length) return legacyCart.items;
    return newCart?.items ?? legacyCart?.items ?? [];
  }, [newCart?.items, legacyCart?.items]);

  const count = useMemo(() => {
    if (!Array.isArray(items)) return 0;
    // Suma cantidades (si no hay quantity, cuenta 1)
    return items.reduce((acc: number, it: any) => acc + Number(it?.quantity ?? it?.qty ?? 1), 0);
  }, [items]);

  const total = useMemo(() => {
    // Si es carrito nuevo, usa su API; si no, aproximamos para legacy
    if (newCart?.computeGrandTotal) return newCart.computeGrandTotal();
    if (!Array.isArray(items)) return 0;
    return items.reduce((acc: number, it: any) => {
      const base = Number(it?.basePrice ?? it?.price ?? 0);
      const addons = Array.isArray(it?.addons)
        ? it.addons.reduce((a: number, x: any) => a + Number(x?.price ?? 0), 0)
        : Array.isArray(it?.options)
        ? it.options.reduce((a: number, x: any) => a + Number(x?.price ?? 0), 0)
        : 0;
      const groups = Array.isArray(it?.optionGroups)
        ? it.optionGroups.reduce(
            (gacc: number, g: any) =>
              gacc + (Array.isArray(g?.items) ? g.items.reduce((iacc: number, gi: any) => iacc + Number(gi?.priceDelta ?? 0), 0) : 0),
            0
          )
        : 0;
      const qty = Number(it?.quantity ?? it?.qty ?? 1);
      return acc + (base + addons + groups) * qty;
    }, 0);
  }, [items, newCart]);

  return (
    <div className={className} {...rest}>
      <Link href={href} className="position-relative d-inline-flex align-items-center text-decoration-none">
        {/* Reemplaza por tu SVG/ícono si lo tienes */}
        <span className="me-1">🛒</span>
        <span>Cart</span>

        {count > 0 && (
          <span
            className="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger"
            style={{ fontSize: '0.65rem' }}
            aria-label={`You have ${count} ítem(s) in your cart`}
          >
            {count}
          </span>
        )}
      </Link>

      {showTotal && (
        <span className="ms-2 text-muted small">{fmtQ(total)}</span>
      )}
    </div>
  );
}
