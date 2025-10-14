// src/app/(tenant)/[tenant]/app/admin/reports/page.tsx
"use client";
import Protected from "@/app/(tenant)/[tenantId]/components/Protected";
import AdminOnly from "@/app/(tenant)/[tenantId]/components/AdminOnly";
import ToolGate from "@/components/ToolGate";
import Link from "next/link";
import React, { useMemo } from "react";

// 🔤 i18n
import { t as translate } from "@/lib/i18n/t";
import { useTenantSettings } from "@/lib/settings/hooks";

/* ✅ Visibilidad por plan */
import { useFeature } from "@/lib/plans/client";

type AdminTile = {
  title: string;
  subtitle?: string;
  href: string;
  emoji: string;
  hint?: string;
};

const TILES: AdminTile[] = [
  { title: "Taxes",     subtitle: "/reports/taxes",             href: "/app/admin/reports/taxes",             emoji: "📊", hint: "Tax reports" },
  { title: "Sales",     subtitle: "/reports/sales-reports",     href: "/app/admin/reports/sales-reports",     emoji: "💰", hint: "Sales reports" },
  { title: "Products",  subtitle: "/reports/product-reports",   href: "/app/admin/reports/product-reports",   emoji: "🍽️", hint: "Product reports" },
  { title: "Clients",   subtitle: "/reports/client-reports",    href: "/app/admin/reports/client-reports",    emoji: "👥", hint: "Client reports" },
  { title: "Promotion", subtitle: "/reports/promotion-reports", href: "/app/admin/reports/promotion-reports", emoji: "🏷️", hint: "Promotions reports" },
  { title: "Delivery",  subtitle: "/reports/delivery-reports",  href: "/app/admin/reports/delivery-reports",  emoji: "🛵", hint: "Delivery reports" },
  { title: "Cashier",   subtitle: "/reports/cashier-reports",   href: "/app/admin/reports/cashier-reports",   emoji: "💵", hint: "Cashier reports" },
  { title: "Time",      subtitle: "/reports/Time-reports",      href: "/app/admin/reports/time-reports",      emoji: "⏰", hint: "Time reports" },
];

/** 🔑 Mapa href → featureKey (según tu matriz Reports Starter/Pro/Full) */
function getFeatureKeyByHref(href: string):
  | 'salesReports' | 'taxesReports' | 'productReports' | 'clientReports'
  | 'promotionReports' | 'deliveryReports' | 'cashierReports' | 'timeReports'
  | null
{
  switch (href) {
    case "/app/admin/reports/sales-reports":     return "salesReports";
    case "/app/admin/reports/taxes":             return "taxesReports";
    case "/app/admin/reports/product-reports":   return "productReports";
    case "/app/admin/reports/client-reports":    return "clientReports";
    case "/app/admin/reports/promotion-reports": return "promotionReports";
    case "/app/admin/reports/delivery-reports":  return "deliveryReports";
    case "/app/admin/reports/cashier-reports":   return "cashierReports";
    case "/app/admin/reports/time-reports":      return "timeReports";
    default: return null;
  }
}

export default function AdminPage() {
  // idioma actual + helper
  const { settings } = useTenantSettings();
  const lang = useMemo(() => {
    try {
      if (typeof window !== "undefined") {
        const ls = localStorage.getItem("tenant.language");
        if (ls) return ls;
      }
    } catch {}
    return (settings as any)?.language;
  }, [settings]);
  const tt = (key: string, fallback: string, vars?: Record<string, unknown>) => {
    const s = translate(lang, key, vars);
    return s === key ? fallback : s;
  };

  // util: clave i18n derivada del slug de la ruta (último segmento del href)
  const slugKey = (href: string) => {
    const slug = href.split("/").filter(Boolean).pop() || "";
    return `admin.reports.${slug}`;
  };

  // 🚦 Hooks de features (uno por tipo de reporte)
  const { allowed: allowSales }     = useFeature('salesReports');
  const { allowed: allowTaxes }     = useFeature('taxesReports');
  const { allowed: allowProducts }  = useFeature('productReports');
  const { allowed: allowClients }   = useFeature('clientReports');
  const { allowed: allowPromo }     = useFeature('promotionReports');
  const { allowed: allowDelivery }  = useFeature('deliveryReports');
  const { allowed: allowCashier }   = useFeature('cashierReports');
  const { allowed: allowTime }      = useFeature('timeReports');

  const isAllowedByKey = (href: string) => {
    const key = getFeatureKeyByHref(href);
    switch (key) {
      case 'salesReports':    return allowSales;
      case 'taxesReports':    return allowTaxes;
      case 'productReports':  return allowProducts;
      case 'clientReports':   return allowClients;
      case 'promotionReports':return allowPromo;
      case 'deliveryReports': return allowDelivery;
      case 'cashierReports':  return allowCashier;
      case 'timeReports':     return allowTime;
      case null: default:     return true; // si no hay mapeo, no bloquear
    }
  };

  return (
    <Protected>
      <AdminOnly>
        {/* Gate de página para el hub de reportes */}
        <ToolGate feature="reports">
          <main className="container py-4">
            <style>{`
              .admin-hero {
                background: linear-gradient(135deg, #0d6efd 0%, #6f42c1 60%, #d63384 100%);
                border-radius: 18px;
                color: #fff;
              }
              .admin-card {
                border: none;
                border-radius: 16px;
                transition: transform .15s ease, box-shadow .15s ease, background-color .2s ease;
                background: #fff;
              }
              .admin-card:hover {
                transform: translateY(-2px);
                box-shadow: 0 10px 24px rgba(16,24,40,.08);
              }
              .admin-emoji {
                font-size: 2rem;
                line-height: 1;
                width: 48px;
                height: 48px;
                display: inline-flex;
                align-items: center;
                justify-content: center;
                border-radius: 12px;
                background: rgba(13,110,253,.08);
              }
              .admin-link { text-decoration: none; color: inherit; }
              .admin-subtle { color: #6c757d; }
              .admin-chip {
                display: inline-flex;
                align-items: center;
                gap: .4rem;
                background: rgba(255,255,255,.2);
                border: 1px solid rgba(255,255,255,.35);
                color: #fff;
                padding: .3rem .6rem;
                border-radius: 999px;
                backdrop-filter: blur(2px);
              }
            `}</style>

            {/* Encabezado */}
            <section className="admin-hero p-4 p-md-5 mb-4 shadow-sm">
              <div className="d-flex flex-column flex-md-row align-items-md-center justify-content-between gap-3">
                <div>
                  <h1 className="h3 m-0 fw-semibold">
                    {tt("admin.home.title", "Admin panel")}
                  </h1>
                  <p className="m-0 mt-2 admin-subtle" style={{ color: "rgba(255,255,255,.85)" }}>
                    {tt("admin.home.subtitle", "Quickly access management tools.")}
                  </p>
                </div>
                <div className="d-flex flex-wrap gap-2">
                  <span className="admin-chip">🔐 {tt("admin.home.badge.onlyAdmin", "Only Admin")}</span>
                  <span className="admin-chip">⚡ {tt("admin.home.badge.quickAccess", "Quick access")}</span>
                </div>
              </div>
            </section>

            {/* Cuadrícula de accesos */}
            <section>
              <div className="row g-3 g-md-4">
                {TILES.map((t) => {
                  if (!isAllowedByKey(t.href)) return null;

                  const base = slugKey(t.href);
                  const title = tt(`${base}.title`, t.title);
                  const hint = tt(`${base}.hint`, t.hint || t.subtitle || "");
                  return (
                    <div key={t.href} className="col-12 col-sm-6 col-lg-4 col-xxl-3">
                      <Link href={t.href} className="admin-link" title={hint}>
                        <div className="card admin-card h-100 shadow-sm">
                          <div className="card-body d-flex flex-column gap-3">
                            <div className="d-flex align-items-center gap-3">
                              <div className="admin-emoji" aria-hidden>{t.emoji}</div>
                              <div>
                                <div className="h5 m-0">{title}</div>
                                {/* Mostramos el subtitle tal como viene (ruta) */}
                                <div className="small text-muted">{t.subtitle}</div>
                              </div>
                            </div>
                            {t.hint && <p className="mb-0 admin-subtle">{hint}</p>}
                            <div className="mt-auto d-flex justify-content-between align-items-center">
                              <span className="text-primary fw-semibold">
                                {tt("admin.home.open", "Open")}
                              </span>
                              <span aria-hidden>↗</span>
                            </div>
                          </div>
                        </div>
                      </Link>
                    </div>
                  );
                })}
              </div>
            </section>
          </main>
        </ToolGate>
      </AdminOnly>
    </Protected>
  );
}
