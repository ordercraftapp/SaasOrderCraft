// src/components/cart-new/CartViewNew.tsx
'use client';

import React, { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useNewCart } from '@/lib/newcart/context';
import type { NewCartItem } from '@/lib/newcart/types';
import { useFmtQ } from '@/lib/settings/money';
import { useAuth } from '@/app/providers';

// 🔤 i18n
import { useTenantSettings } from '@/lib/settings/hooks';
import { t as translate } from '@/lib/i18n/t';

export default function CartViewNew() {
  const cart = useNewCart();
  const fmtQ = useFmtQ();
  const { user } = useAuth();
  const router = useRouter();

  // 🔤 idioma actual + helper (LS -> settings.language)
  const { settings } = useTenantSettings();
  const lang = React.useMemo(() => {
    try {
      if (typeof window !== 'undefined') {
        const ls = localStorage.getItem('tenant.language');
        if (ls) return ls;
      }
    } catch {}
    return (settings as any)?.language;
  }, [settings]);
  const tt = (key: string, fallback: string, vars?: Record<string, unknown>) => {
    const s = translate(lang, key, vars);
    return s === key ? fallback : s;
  };

  const lines: NewCartItem[] = cart.items;
  const grand = useMemo(() => cart.computeGrandTotal(), [cart, lines]);

  const handleGoToCheckout = () => {
    if (!lines.length) return;
    if (!user) {
      router.push('/login?next=/checkout-cards');
      return;
    }
    router.push('/checkout-cards');
  };

  return (
    <div className="card border-0 shadow-sm">
      <div className="card-header d-flex align-items-center justify-content-between">
        <div className="fw-semibold">{tt('cart.title', 'Your Cart')}</div>
        {lines.length > 0 && (
          <button className="btn btn-sm btn-outline-danger" onClick={() => cart.clear()}>
            {tt('cart.emptyBtn', 'Empty')}
          </button>
        )}
      </div>

      <div className="card-body">
        {lines.length === 0 && <div className="text-muted">{tt('cart.empty', 'Your cart is empty.')}</div>}

        <div className="d-flex flex-column gap-3">
          {lines.map((ln, idx) => {
            const unitExtras = cart.computeLineTotal({ ...ln, quantity: 1 }) - ln.basePrice;
            const lineSum = cart.computeLineTotal(ln);
            return (
              <div key={`${ln.menuItemId}-${idx}`} className="border rounded p-3">
                <div className="d-flex justify-content-between align-items-start">
                  <div className="me-3">
                    <div className="fw-semibold">
                      {ln.menuItemName} <span className="text-muted">× {ln.quantity}</span>
                    </div>
                    <div className="text-muted small">
                      {tt('cart.base', 'Base')}: {fmtQ(ln.basePrice)}{' '}
                      {unitExtras > 0 ? `· ${tt('cart.extras', 'Extras')}: ${fmtQ(unitExtras)}/${tt('cart.perUnitShort', 'ea')}` : ''}
                    </div>
                  </div>
                  <div className="text-end">
                    <div className="fw-semibold">{fmtQ(lineSum)}</div>
                    <div className="text-muted small">
                      ({fmtQ(ln.basePrice + unitExtras)} {tt('cart.perUnitShort', 'ea')})
                    </div>
                  </div>
                </div>

                <div className="mt-2 d-flex align-items-center justify-content-between">
                  <div className="btn-group btn-group-sm">
                    <button
                      className="btn btn-outline-secondary"
                      onClick={() => cart.updateQuantity(idx, Math.max(1, (ln.quantity || 1) - 1))}
                    >
                      −
                    </button>
                    <button className="btn btn-outline-secondary" disabled>
                      {ln.quantity}
                    </button>
                    <button
                      className="btn btn-outline-secondary"
                      onClick={() => cart.updateQuantity(idx, (ln.quantity || 1) + 1)}
                    >
                      +
                    </button>
                  </div>
                  <button className="btn btn-sm btn-outline-danger" onClick={() => cart.remove(idx)}>
                    {tt('cart.remove', 'Remove')}
                  </button>
                </div>

                {(ln.addons.length > 0 || ln.optionGroups.some(g => g.items.length > 0)) && (
                  <div className="mt-3">
                    {ln.addons.length > 0 && (
                      <div className="mb-1">
                        {ln.addons.map((ad, i) => (
                          <div className="d-flex justify-content-between small" key={`ad-${idx}-${i}`}>
                            <div>— ({tt('cart.addons', 'Add-ons')}) {ad.name}</div>
                            <div>{fmtQ(ad.price)}</div>
                          </div>
                        ))}
                      </div>
                    )}

                    {ln.optionGroups.map(g => (
                      g.items.length > 0 && (
                        <div className="mb-1" key={`g-${idx}-${g.groupId}`}>
                          {g.items.map(it => (
                            <div className="d-flex justify-content-between small" key={`gi-${idx}-${g.groupId}-${it.id}`}>
                              <div>— ({tt('cart.groupItems', 'Group items')}) {it.name}</div>
                              <div>{fmtQ(it.priceDelta)}</div>
                            </div>
                          ))}
                        </div>
                      )
                    ))}
                  </div>
                )}

                <div className="mt-2 border-top pt-2 d-flex justify-content-between">
                  <div className="fw-semibold">{tt('cart.lineTotal', 'Total')}</div>
                  <div className="fw-semibold">{fmtQ(lineSum)}</div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div className="card-footer d-flex justify-content-between align-items-center">
        <div className="fw-semibold">{tt('cart.totalToPay', 'Total to pay')}</div>
        <div className="d-flex align-items-center gap-2">
          <div className="fw-bold fs-5">{fmtQ(grand)}</div>
          <button
            type="button"
            className="btn btn-primary"
            onClick={handleGoToCheckout}
            disabled={!lines.length}
            aria-disabled={!lines.length}
            title={
              !lines.length
                ? tt('cart.empty', 'Your cart is empty.')
                : (user ? tt('cart.proceed', 'Proceed to checkout') : tt('cart.loginToContinue', 'Log in to continue'))
            }
          >
            {tt('cart.goCheckout', 'Go to checkout')}
          </button>
        </div>
      </div>
    </div>
  );
}
