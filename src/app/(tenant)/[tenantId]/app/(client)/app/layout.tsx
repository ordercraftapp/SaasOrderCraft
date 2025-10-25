// src/app/(tenant)/[tenantId]/app/cart-new/layout.tsx
'use client';

import React, { useState, useMemo } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import CartBadge from '@/app/(tenant)/[tenantId]/components/CartBadge';
import { useTenantSettings } from '@/lib/settings/hooks';
import { t as translate } from '@/lib/i18n/t';
import { useTenantId } from '@/lib/tenant/context';
import { NewCartProvider } from '@/lib/newcart/context'; // 👈

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const tenantIdCtx = useTenantId();

  const tenantFromPath = useMemo(() => {
    const segs = (pathname || '').split('/').filter(Boolean);
    return segs[0] || undefined;
  }, [pathname]);

  const tenantId = tenantIdCtx || tenantFromPath;

  const withTenant = (p: string) => {
    const norm = p.startsWith('/') ? p : `/${p}`;
    if (!tenantId) return norm;
    if (norm.startsWith(`/${tenantId}/`)) return norm;
    return `/${tenantId}${norm}`;
  };

  const isActive = (href: string) => {
    const full = withTenant(href);
    return pathname?.startsWith(full);
  };

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

  return (
    // 👇 Proveedor al nivel del layout, para que NAV + página compartan **el mismo** estado
    <NewCartProvider key={tenantId || 'no-tenant'}>
      <nav className="navbar navbar-expand-md navbar-light bg-light border-bottom">
        <div className="container">
          <Link className="navbar-brand fw-semibold" href={withTenant('/app/app')}>
            {tt('client.app.nav.brand', 'Customer Portal')}
          </Link>

          <button
            className="navbar-toggler"
            type="button"
            aria-label={tt('client.app.nav.toggle', 'Toggle navigation')}
            aria-expanded={open ? 'true' : 'false'}
            onClick={() => setOpen((v) => !v)}
          >
            <span className="navbar-toggler-icon"></span>
          </button>

          <div className={`collapse navbar-collapse${open ? ' show' : ''}`}>
            <ul className="navbar-nav me-auto mb-2 mb-md-0">
              <li className="nav-item">
                <Link className={`nav-link ${isActive('/app/menu') ? 'active' : ''}`} href={withTenant('/app/menu')}>
                  {tt('client.app.nav.menu', 'Menu')}
                </Link>
              </li>
              <li className="nav-item">
                <Link className={`nav-link ${isActive('/app/cart-new') ? 'active' : ''}`} href={withTenant('/app/cart-new')}>
                  {tt('client.app.nav.cart', 'Cart')}
                </Link>
              </li>
              <li className="nav-item">
                <Link className={`nav-link ${isActive('/app/app/orders') ? 'active' : ''}`} href={withTenant('/app/app/orders')}>
                  {tt('client.app.nav.orders', 'Orders')}
                </Link>
              </li>
              <li className="nav-item">
                <Link className={`nav-link ${isActive('/app/app/tracking') ? 'active' : ''}`} href={withTenant('/app/app/tracking')}>
                  {tt('client.app.nav.tracking', 'Tracking')}
                </Link>
              </li>
            </ul>

            <div className="d-flex align-items-center gap-2">
              <CartBadge href={withTenant('/app/cart-new')} />
              <Link className="btn btn-outline-secondary btn-sm" href={withTenant('/app/logout')}>
                {tt('client.app.nav.logout', 'Logout')}
              </Link>
            </div>
          </div>
        </div>
      </nav>

      <main className="container py-4">{children}</main>
    </NewCartProvider>
  );
}
