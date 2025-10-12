// src/app/(tenant)/[tenantId]/app/checkout-cards/layout.tsx
'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import CartBadge from '@/app/(tenant)/[tenantId]/components/CartBadge';

/* 🔤 i18n */
import { t as translate } from '@/lib/i18n/t';
import { useTenantSettings } from '@/lib/settings/hooks';

// Phase C: tenant en cliente
import { useTenantId } from '@/lib/tenant/context';

/* --------------------------------------------
   🔤 Helper i18n (igual al patrón usado en Checkout)
--------------------------------------------- */
function useLangTT() {
  const { settings } = useTenantSettings();
  const lang = useMemo(() => {
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
  return { lang, tt } as const;
}

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const { tt } = useLangTT();
  const tenantIdCtx = useTenantId();

  // tenancyUpdate: fallback de tenant desde la URL si el contexto aún no está listo
  const tenantFromPath = useMemo(() => {
    const segs = (pathname || '').split('/').filter(Boolean); // "/{tenantId}/app/..." => ["{tenantId}", "app", ...]
    return segs[0] || undefined;
  }, [pathname]);

  const tenantId = tenantIdCtx || tenantFromPath; // tenancyUpdate

  // Prefijador de rutas con /{tenantId}
  const withTenant = (p: string) => {
    const norm = p.startsWith('/') ? p : `/${p}`;
    if (!tenantId) return norm; // tenancyUpdate: al menos devolvemos absoluto
    if (norm.startsWith(`/${tenantId}/`)) return norm;
    return `/${tenantId}${norm}`;
  };

  const isActive = (href: string) => {
    const full = withTenant(href);
    return pathname?.startsWith(full);
  };

  return (
    <>
      <nav className="navbar navbar-expand-md navbar-light bg-light border-bottom">
        <div className="container">
          <Link className="navbar-brand fw-semibold" href={withTenant('/app')}>
            {tt('client.nav.brand', 'Customer Portal')}
          </Link>

          <button
            className="navbar-toggler"
            type="button"
            aria-label={tt('client.nav.toggleAria', 'Toggle navigation')}
            aria-expanded={open ? 'true' : 'false'}
            onClick={() => setOpen((v) => !v)}
          >
            <span className="navbar-toggler-icon"></span>
          </button>

          <div className={`collapse navbar-collapse${open ? ' show' : ''}`}>
            <ul className="navbar-nav me-auto mb-2 mb-md-0">
              <li className="nav-item">
                <Link
                  className={`nav-link ${isActive('/app/menu') ? 'active' : ''}`}
                  href={withTenant('/app/menu')}
                >
                  {tt('client.nav.menu', 'Menu')}
                </Link>
              </li>
              <li className="nav-item">
                <Link
                  className={`nav-link ${isActive('/app/cart-new') ? 'active' : ''}`}
                  href={withTenant('/app/cart-new')}
                >
                  {tt('client.nav.cart', 'Cart')}
                </Link>
              </li>
              <li className="nav-item">
                <Link
                  className={`nav-link ${isActive('/app/orders') ? 'active' : ''}`}
                  href={withTenant('/app/orders')}
                >
                  {tt('client.nav.orders', 'Orders')}
                </Link>
              </li>
              <li className="nav-item">
                <Link
                  className={`nav-link ${isActive('/app/tracking') ? 'active' : ''}`}
                  href={withTenant('/app/tracking')}
                >
                  {tt('client.nav.tracking', 'Tracking')}
                </Link>
              </li>
            </ul>

            <div className="d-flex align-items-center gap-2">
              {/* CartBadge ya cuenta items con useCart */}
              <CartBadge href={withTenant('/app/cart-new')} />
              <Link className="btn btn-outline-secondary btn-sm" href={withTenant('/app/logout')}>
                {tt('client.nav.logout', 'Logout')}
              </Link>
            </div>
          </div>
        </div>
      </nav>

      <main className="container py-4">{children}</main>
    </>
  );
}
