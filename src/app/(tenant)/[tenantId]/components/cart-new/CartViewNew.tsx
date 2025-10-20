// src/app/(tenant)/[tenantId]/components/cart-new/CartViewNew.tsx
'use client';

import React, { useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useNewCart } from '@/lib/newcart/context';
import type { NewCartItem } from '@/lib/newcart/types';
import { useFmtQ } from '@/lib/settings/money';
import { useAuth } from '@/app/(tenant)/[tenantId]/app/providers';
import { tenantPath } from '@/lib/tenant/paths';

// 🔤 i18n
import { useTenantSettings } from '@/lib/settings/hooks';
import { t as translate } from '@/lib/i18n/t';

// Phase C: tenant en cliente
import { useTenantId } from '@/lib/tenant/context';

function lineStableKey(ln: NewCartItem, fallbackIndex: number) {
  // Firmas estables usando campos que sí existen en tu modelo
  const groups = (ln.optionGroups ?? [])
    .map((g, gi) => {
      const itemsSig = (g.items ?? [])
        .map((it, ii) => {
          // it.id puede no existir -> usar it.name o el índice
          const itId = (it as any).id ?? it.name ?? ii;
          const delta = (it as any).priceDelta ?? 0;
          return `${itId}:${delta}`;
        })
        .join(',');
      // g.groupId existe en tu UI; si no, usa índice
      const gid = (g as any).groupId ?? gi;
      return `${gid}[${itemsSig}]`;
    })
    .join('|');

  const addons = (ln.addons ?? [])
    .map((a, ai) => {
      // a.id puede no existir -> usar a.name o índice
      const aId = (a as any).id ?? a.name ?? ai;
      const price = (a as any).price ?? 0;
      return `${aId}:${price}`;
    })
    .join('|');

  // menuItemId existe; si no, usa name o un literal
  const itemId = (ln as any).menuItemId ?? ln.menuItemName ?? 'item';
  const qty = ln.quantity ?? 1;

  // No usamos ln.uid porque no está en tu tipo
  return `${itemId}__q${qty}__g[${groups}]__a[${addons}]__i${fallbackIndex}`;
}


export default function CartViewNew() {
  const cart = useNewCart();
  const fmtQ = useFmtQ();
  const { user } = useAuth();
  const router = useRouter();
  const tenantId = useTenantId();

  const withTenant = (p: string) => {
    const norm = p.startsWith('/') ? p : `/${p}`;
    if (!tenantId) return norm;
    return tenantPath(tenantId, norm);
  };

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
    // si quieres forzar siempre fallback en ausencia de traducción, queda así
  };

  const lines: NewCartItem[] = cart.items;
  // ✅ recalcula solo cuando cambia el arreglo de líneas (evita depender del objeto cart)
  const grand = useMemo(() => cart.computeGrandTotal(), [lines]);

  const handleGoToCheckout = () => {
    if (!lines.length) return;
    const checkoutPath = withTenant('/app/checkout-cards');
    if (!user) {
      const next = encodeURIComponent(checkoutPath);
      router.push(withTenant(`/app/login?next=${next}`));
      return;
    }
    router.push(checkoutPath);
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
        {lines.length === 0 && (
          <div className="text-muted">{tt('cart.empty', 'Your cart is empty.')}</div>
        )}

        <div className="d-flex flex-column gap-3">
          {lines.map((ln, idx) => {
            const qty = ln.quantity ?? 1;
            const addons = ln.addons ?? [];
            const groups = ln.optionGroups ?? [];
            const unitExtras =
              cart.computeLineTotal({ ...ln, quantity: 1 }) - (ln.basePrice ?? 0);
            const lineSum = cart.computeLineTotal(ln);
            const key = lineStableKey(ln, idx);

            return (
              <div key={key} className="border rounded p-3">
                <div className="d-flex justify-content-between align-items-start">
                  <div className="me-3">
                    <div className="fw-semibold">
                      {ln.menuItemName} <span className="text-muted">× {qty}</span>
                    </div>
                    <div className="text-muted small">
                      {tt('cart.base', 'Base')}: {fmtQ(ln.basePrice)}{' '}
                      {unitExtras > 0
                        ? `· ${tt('cart.extras', 'Extras')}: ${fmtQ(unitExtras)}/${tt(
                            'cart.perUnitShort',
                            'ea'
                          )}`
                        : ''}
                    </div>
                  </div>
                  <div className="text-end">
                    <div className="fw-semibold">{fmtQ(lineSum)}</div>
                    <div className="text-muted small">
                      ({fmtQ((ln.basePrice ?? 0) + unitExtras)} {tt('cart.perUnitShort', 'ea')})
                    </div>
                  </div>
                </div>

                <div className="mt-2 d-flex align-items-center justify-content-between">
                  <div className="btn-group btn-group-sm">
                    <button
                      className="btn btn-outline-secondary"
                      onClick={() => cart.updateQuantity(idx, Math.max(1, qty - 1))}
                    >
                      −
                    </button>
                    <button className="btn btn-outline-secondary" disabled>
                      {qty}
                    </button>
                    <button
                      className="btn btn-outline-secondary"
                      onClick={() => cart.updateQuantity(idx, qty + 1)}
                    >
                      +
                    </button>
                  </div>
                  <button className="btn btn-sm btn-outline-danger" onClick={() => cart.remove(idx)}>
                    {tt('cart.remove', 'Remove')}
                  </button>
                </div>

                {(addons.length > 0 || groups.some(g => (g.items ?? []).length > 0)) && (
                  <div className="mt-3">
                    {addons.length > 0 && (
                      <div className="mb-1">
                        {addons.map((ad, i) => (
                          <div className="d-flex justify-content-between small" key={`ad-${key}-${i}`}>
                            <div>— ({tt('cart.addons', 'Add-ons')}) {ad.name}</div>
                            <div>{fmtQ(ad.price)}</div>
                          </div>
                        ))}
                      </div>
                    )}

                    {groups.map(g =>
                      (g.items ?? []).length > 0 ? (
                        <div className="mb-1" key={`g-${key}-${g.groupId}`}>
                          {(g.items ?? []).map(it => (
                            <div className="d-flex justify-content-between small" key={`gi-${key}-${g.groupId}-${it.id}`}>
                              <div>— ({tt('cart.groupItems', 'Group items')}) {it.name}</div>
                              <div>{fmtQ(it.priceDelta)}</div>
                            </div>
                          ))}
                        </div>
                      ) : null
                    )}
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
                : user
                ? tt('cart.proceed', 'Proceed to checkout')
                : tt('cart.loginToContinue', 'Log in to continue')
            }
          >
            {tt('cart.goCheckout', 'Go to checkout')}
          </button>
        </div>
      </div>
    </div>
  );
}
