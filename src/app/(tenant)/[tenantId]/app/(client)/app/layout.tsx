// src/app/(tenant)/[tenant]/app/(client)/app/layout.tsx
'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useParams } from 'next/navigation';
import CartBadge from '@/app/(tenant)/[tenantId]/components/CartBadge';

// i18n
import { t, getLang } from '@/lib/i18n/t';
import { useTenantSettings } from '@/lib/settings/hooks';

function useTenantAppBase() {
  const params = useParams<{ tenant: string }>();
  const tenant = (params?.tenant || '').trim();
  return `/${tenant}/app`;
}

export default function ClientLayout(
  props: { children: React.ReactNode } & { serverLang?: string }
) {
  const { children } = props;
  const serverLang = (props as any)?.serverLang as string | undefined;

  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const appBase = useTenantAppBase(); // 👈 /{tenant}/app

  // idioma actual desde settings / localStorage
  const { settings } = useTenantSettings();
  const rawLang =
    (settings as any)?.language ??
    (typeof window !== 'undefined' ? localStorage.getItem('tenant.language') || undefined : undefined);

  // 1) Primer render con serverLang para evitar hydration mismatch
  const [lang, setLang] = useState<string>(serverLang ? getLang(serverLang) : getLang(rawLang));

  // 2) Tras el mount, aplicar override del cliente si cambió
  useEffect(() => {
    const next = getLang(
      (settings as any)?.language ??
        (typeof window !== 'undefined' ? localStorage.getItem('tenant.language') || undefined : undefined)
    );
    if (next !== lang) setLang(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  const isActive = (href: string) => pathname?.startsWith(href);

  // Rutas tenant-aware
  const hrefHome = `${appBase}`;
  const hrefMenu = `${appBase}/menu`;
  const hrefCart = `${appBase}/cart-new`;
  const hrefOrders = `${appBase}/orders`;
  const hrefTracking = `${appBase}/tracking`;
  const hrefLogout = `/${(useParams() as any)?.tenant || ''}/logout`;

  return (
    <>
      <nav className="navbar navbar-expand-md navbar-light bg-light border-bottom">
        <div className="container">
          <Link className="navbar-brand fw-semibold" href={hrefHome}>
            {t(lang, 'nav.brand')}
          </Link>

          <button
            className="navbar-toggler"
            type="button"
            aria-label={t(lang, 'nav.toggle')}
            aria-expanded={open ? 'true' : 'false'}
            onClick={() => setOpen((v) => !v)}
          >
            <span className="navbar-toggler-icon"></span>
          </button>

          <div className={`collapse navbar-collapse${open ? ' show' : ''}`}>
            <ul className="navbar-nav me-auto mb-2 mb-md-0">
              <li className="nav-item">
                <Link className={`nav-link ${isActive(hrefMenu) ? 'active' : ''}`} href={hrefMenu}>
                  {t(lang, 'nav.menu')}
                </Link>
              </li>
              <li className="nav-item">
                <Link className={`nav-link ${isActive(hrefCart) ? 'active' : ''}`} href={hrefCart}>
                  {t(lang, 'nav.cart')}
                </Link>
              </li>
              <li className="nav-item">
                <Link className={`nav-link ${isActive(hrefOrders) ? 'active' : ''}`} href={hrefOrders}>
                  {t(lang, 'nav.orders')}
                </Link>
              </li>
              <li className="nav-item">
                <Link className={`nav-link ${isActive(hrefTracking) ? 'active' : ''}`} href={hrefTracking}>
                  {t(lang, 'nav.tracking')}
                </Link>
              </li>
            </ul>

            <div className="d-flex align-items-center gap-2">
              <CartBadge href={hrefCart} />
              <Link className="btn btn-outline-secondary btn-sm" href={hrefLogout}>
                {t(lang, 'nav.logout')}
              </Link>
            </div>
          </div>
        </div>
      </nav>

      <main className="container py-4">{children}</main>
    </>
  );
}
