// src/app/(tenant)/[tenant]/app/admin/reports/layout.tsx
'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import Protected from '@/app/(tenant)/[tenantId]/components/Protected';
import ToolGate from '@/components/ToolGate';
import AdminOnly from '@/app/(tenant)/[tenantId]/components/AdminOnly';
import { useTenantId } from '@/lib/tenant/context';

// 🔤 i18n
import { t as translate } from '@/lib/i18n/t';
import { useTenantSettings } from '@/lib/settings/hooks';

/* ✅ Visibilidad por plan */
import { useFeature } from '@/lib/plans/client';

/** Tipado local */
type ReportLink = {
  title: string;
  subtitle?: string;
  href: string;   // <-- base sin tenant (empieza con /admin/...)
  emoji: string;
  hint?: string;
};

const REPORT_LINKS: ReportLink[] = [
  { title: 'Taxes',     subtitle: '/reports/taxes',             href: '/admin/reports/taxes',             emoji: '📊', hint: 'Tax reports' },
  { title: 'Sales',     subtitle: '/reports/sales-reports',     href: '/admin/reports/sales-reports',     emoji: '💰', hint: 'Sales reports' },
  { title: 'Products',  subtitle: '/reports/product-reports',   href: '/admin/reports/product-reports',   emoji: '🍽️', hint: 'Product reports' },
  { title: 'Clients',   subtitle: '/reports/client-reports',    href: '/admin/reports/client-reports',    emoji: '👥', hint: 'Client reports' },
  { title: 'Promotion', subtitle: '/reports/promotion-reports', href: '/admin/reports/promotion-reports', emoji: '🏷️', hint: 'Promotions reports' },
  { title: 'Delivery',  subtitle: '/reports/delivery-reports',  href: '/admin/reports/delivery-reports',  emoji: '🛵', hint: 'Delivery reports' },
  { title: 'Cashier',   subtitle: '/reports/cashier-reports',   href: '/admin/reports/cashier-reports',   emoji: '💵', hint: 'Cashier reports' },
  { title: 'Time',      subtitle: '/reports/time-reports',      href: '/admin/reports/time-reports',      emoji: '⏰', hint: 'Time reports' },
];

function getFeatureKeyByHref(href: string):
  | 'salesReports' | 'taxesReports' | 'productReports' | 'clientReports'
  | 'promotionReports' | 'deliveryReports' | 'cashierReports' | 'timeReports'
  | null
{
  switch (href) {
    case '/admin/reports/sales-reports':     return 'salesReports';
    case '/admin/reports/taxes':             return 'taxesReports';
    case '/admin/reports/product-reports':   return 'productReports';
    case '/admin/reports/client-reports':    return 'clientReports';
    case '/admin/reports/promotion-reports': return 'promotionReports';
    case '/admin/reports/delivery-reports':  return 'deliveryReports';
    case '/admin/reports/cashier-reports':   return 'cashierReports';
    case '/admin/reports/time-reports':      return 'timeReports';
    default: return null;
  }
}

export default function ReportsLayout({ children }: { children: React.ReactNode }) {
  const tenantId = useTenantId();
  const railRef = useRef<HTMLDivElement | null>(null);

  // 🔤 idioma actual + helper
  const { settings } = useTenantSettings();
  const [lang, setLang] = useState<string | undefined>(() => (settings as any)?.language);

  useEffect(() => {
    try {
      const ls = localStorage.getItem('tenant.language');
      setLang(ls || (settings as any)?.language);
    } catch {
      setLang((settings as any)?.language);
    }
  }, [settings]);

  const tt = (key: string, fallback: string, vars?: Record<string, unknown>) => {
    const s = translate(lang, key, vars);
    return s === key ? fallback : s;
  };

  // drag-to-scroll state
  const [drag, setDrag] = useState({ active: false, startX: 0, startLeft: 0, moved: false });
  const isInteractive = (el: EventTarget | null) =>
    el instanceof HTMLElement && !!el.closest('a,button,input,textarea,select,summary,[role="button"]');

  const onPointerDown: React.PointerEventHandler<HTMLDivElement> = (e) => {
    if (isInteractive(e.target)) return;
    const el = railRef.current;
    if (!el) return;
    setDrag({ active: true, startX: e.clientX, startLeft: el.scrollLeft, moved: false });
  };
  const onPointerMove: React.PointerEventHandler<HTMLDivElement> = (e) => {
    const el = railRef.current;
    if (!el || !drag.active) return;
    const dx = e.clientX - drag.startX;
    if (Math.abs(dx) > 5 && !drag.moved) setDrag((d) => ({ ...d, moved: true }));
    el.scrollLeft = drag.startLeft - dx;
  };
  const endDrag: React.PointerEventHandler<HTMLDivElement> = () => {
    if (!drag.active) return;
    setDrag((d) => ({ ...d, active: false }));
  };

  // util: clave i18n desde el slug de r.href (sin tenant)
  const slugKey = (href: string) => {
    const slug = href.split('/').filter(Boolean).pop() || '';
    return `admin.reports.${slug}`;
  };

  /* ✅ Visibilidad de cada reporte (por plan) */
  const { allowed: allowSales }     = useFeature('salesReports');
  const { allowed: allowTaxes }     = useFeature('taxesReports');
  const { allowed: allowProducts }  = useFeature('productReports');
  const { allowed: allowClients }   = useFeature('clientReports');
  const { allowed: allowPromo }     = useFeature('promotionReports');
  const { allowed: allowDelivery }  = useFeature('deliveryReports');
  const { allowed: allowCashier }   = useFeature('cashierReports');
  const { allowed: allowTime }      = useFeature('timeReports');

  const allowedByHref: Record<string, boolean> = {
    '/admin/reports/sales-reports':     allowSales,
    '/admin/reports/taxes':             allowTaxes,
    '/admin/reports/product-reports':   allowProducts,
    '/admin/reports/client-reports':    allowClients,
    '/admin/reports/promotion-reports': allowPromo,
    '/admin/reports/delivery-reports':  allowDelivery,
    '/admin/reports/cashier-reports':   allowCashier,
    '/admin/reports/time-reports':      allowTime,
  };

  // Mientras no haya tenantId, evita renderizar links rotos/prefetch 404
  if (!tenantId) {
    return (
      <Protected>
        <AdminOnly>
          <ToolGate feature="reports">
            <div className="container py-4">
              <div className="text-center text-muted">Loading tenant…</div>
              <div className="container mt-3">{children}</div>
            </div>
          </ToolGate>
        </AdminOnly>
      </Protected>
    );
  }

  return (
    <Protected>
      <AdminOnly>
        <ToolGate feature="reports">
          <div className="container-fluid py-3">
            <div className="container">
              <h1 className="h4 mb-3 text-center">{tt('admin.reports.title', 'Reports')}</h1>

              {/* Grid 2 filas, móvil-friendly, con arrastre horizontal */}
              <div className="mx-auto" style={{ maxWidth: 'min(1100px, 100%)' }}>
                <div
                  ref={railRef}
                  role="region"
                  aria-label={tt('admin.reports.shortcuts', 'Report shortcuts')}
                  className="reports-rail"
                  onPointerDown={onPointerDown}
                  onPointerMove={onPointerMove}
                  onPointerUp={endDrag}
                  onPointerCancel={endDrag}
                  onClickCapture={(e) => {
                    if (drag.moved) {
                      e.preventDefault();
                      e.stopPropagation();
                    }
                  }}
                  onWheel={(e) => {
                    const el = railRef.current;
                    if (!el) return;
                    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) el.scrollLeft += e.deltaY;
                  }}
                >
                  <style jsx>{`
                    .reports-rail {
                      display: grid;
                      grid-auto-flow: column;         /* Llena por columnas */
                      grid-template-rows: repeat(2, auto); /* ✅ Siempre 2 filas */
                      grid-auto-columns: max-content; /* Chips tamaño contenido */
                      column-gap: 12px;
                      row-gap: 10px;

                      overflow-x: auto;
                      -webkit-overflow-scrolling: touch;
                      scroll-behavior: smooth;
                      padding: 8px 12px;

                      scroll-snap-type: x mandatory;
                      scrollbar-width: none;
                      -ms-overflow-style: none;
                      cursor: ${drag.active ? 'grabbing' : 'grab'};
                      user-select: ${drag.active ? 'none' : 'auto'};
                    }
                    .reports-rail::-webkit-scrollbar { display: none; }

                    /* En pantallas medianas o mayores, centramos y evitamos scroll si cabe */
                    @media (min-width: 768px) {
                      .reports-rail {
                        justify-content: center;      /* centra columnas */
                      }
                    }

                    @media (max-width: 576px) {
                      .reports-rail :global(a.btn) {
                        padding-left: 12px !important;
                        padding-right: 12px !important;
                      }
                    }
                  `}</style>

                  {REPORT_LINKS
                    .filter(r => allowedByHref[r.href] ?? true)
                    .map((r) => {
                      const base = slugKey(r.href);
                      const fallbackHint: string = (r.hint ?? r.subtitle ?? '');
                      const title = tt(`${base}.title`, r.title);
                      const hint  = tt(`${base}.hint`,  fallbackHint);

                      // ✅ href final con tenant
                      const fullHref = `/${tenantId}/app${r.href}`;

                      return (
                        <Link
                          key={r.href}
                          href={fullHref}
                          className="btn btn-outline-secondary d-inline-flex align-items-center gap-2 px-3 py-2"
                          title={hint}
                          style={{
                            scrollSnapAlign: 'center',
                            whiteSpace: 'nowrap',
                            borderRadius: 9999,
                            flex: '0 0 auto', // no afecta al grid, pero mantiene el chip compacto
                          }}
                          prefetch
                        >
                          <span aria-hidden="true" style={{ fontSize: 22, lineHeight: 1 }}>{r.emoji}</span>
                          <span className="fw-semibold">{title}</span>
                        </Link>
                      );
                    })}
                </div>
              </div>
            </div>

            <div className="container mt-3">{children}</div>
          </div>
        </ToolGate>
      </AdminOnly>
    </Protected>
  );
}
