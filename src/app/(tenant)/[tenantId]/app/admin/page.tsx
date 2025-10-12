// src/app/(tenant)/[tenant]/app/admin/page.tsx
"use client";

import Protected from "@/app/(tenant)/[tenantId]/components/Protected";
import AdminOnly from "@/app/(tenant)/[tenantId]/components/AdminOnly";
import Link from "next/link";
import React from "react";

// 🔤 i18n (usar lenguaje desde settings)
import { useTenantSettings } from "@/lib/settings/hooks";
import { t as translate } from "@/lib/i18n/t";

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
  { title: "Kitchen",     subtitle: "admin/kitchen",     href: "/admin/kitchen",     emoji: "🍳", hint: "Orders and kitchen status" },
  { title: "Cashier",     subtitle: "admin/cashier",     href: "/admin/cashier",     emoji: "💵", hint: "Collection, receipts and closing" },
  { title: "Delivery",    subtitle: "admin/delivery",    href: "/admin/delivery",    emoji: "🚚", hint: "Allocation and monitoring" },
  { title: "Menu",        subtitle: "admin/menu",        href: "/admin/menu",        emoji: "📋", hint: "Categories, subcategories and dishes" },
  { title: "Tables",      subtitle: "admin/waiter",      href: "/admin/waiter",      emoji: "🍴", hint: "Manage tables" },
  { title: "Orders",      subtitle: "admin/orders",      href: "/admin/orders",      emoji: "🧾", hint: "List and details of orders" },
  { title: "Edit Orders", subtitle: "admin/edit-orders", href: "/admin/edit-orders", emoji: "✏️", hint: "Edit existing orders" },
  { title: "Roles",       subtitle: "admin/roles",       href: "/admin/roles",       emoji: "👥", hint: "Management of permits and personnel" },
  { title: "OPS",         subtitle: "admin/ops",         href: "/admin/ops",         emoji: "🛠️", hint: "Operations and tools" },
  { title: "Promotions",  subtitle: "admin/promotions",  href: "/admin/promotions",  emoji: "🎟️", hint: "Discount codes and conditions" },
  { title: "Delivery options",  subtitle: "admin/delivery-options",  href: "/admin/delivery-options",  emoji: "🛵", hint: "Manage delivery options" },
  { title: "Marketing", subtitle: "admin/marketing", href: "/admin/marketing", emoji: "✉️", hint: "Brevo: contactos y campañas" },
  { title: "Taxes", subtitle: "admin/taxes", href: "/admin/taxes", emoji: "🧾", hint: "Configure tax profile" },
  { title: "Reports", subtitle: "admin/reports", href: "/admin/reports", emoji: "📊", hint: "Create reports" },
  { title: "AI Studio", subtitle: "admin/ai-studio", href: "/admin/ai-studio", emoji: "🤖", hint: "Create Dishes & Promots with AI" },
  { title: "Language & Currency", subtitle: "admin/settings", href: "/admin/settings", emoji: "⚙️", hint: "Set the currency and language" },
  { title: "Settings", subtitle: "admin/home-configure", href: "/admin/home-configure", emoji: "🏠", hint: "Configure the Home Page" },
];

function getTitleKeyByHref(href: string): string {
  switch (href) {
    case "/admin/kitchen": return "admin.tiles.kitchen.title";
    case "/admin/cashier": return "admin.tiles.cashier.title";
    case "/admin/delivery": return "admin.tiles.delivery.title";
    case "/admin/menu": return "admin.tiles.menu.title";
    case "/admin/waiter": return "admin.tiles.tables.title";
    case "/admin/orders": return "admin.tiles.orders.title";
    case "/admin/edit-orders": return "admin.tiles.editOrders.title";
    case "/admin/roles": return "admin.tiles.roles.title";
    case "/admin/ops": return "admin.tiles.ops.title";
    case "/admin/promotions": return "admin.tiles.promotions.title";
    case "/admin/delivery-options": return "admin.tiles.deliveryOptions.title";
    case "/admin/marketing": return "admin.tiles.marketing.title";
    case "/admin/taxes": return "admin.tiles.taxes.title";
    case "/admin/reports": return "admin.tiles.reports.title";
    case "/admin/ai-studio": return "admin.tiles.aiStudio.title";
    case "/admin/settings": return "admin.tiles.settings.title";
    case "/admin/home-configure": return "admin.tiles.homeConfigure.title";
    default: return "admin.tiles.unknown.title";
  }
}

function getHintKeyByHref(href: string): string {
  switch (href) {
    case "/admin/kitchen": return "admin.tiles.kitchen.hint";
    case "/admin/cashier": return "admin.tiles.cashier.hint";
    case "/admin/delivery": return "admin.tiles.delivery.hint";
    case "/admin/menu": return "admin.tiles.menu.hint";
    case "/admin/waiter": return "admin.tiles.tables.hint";
    case "/admin/orders": return "admin.tiles.orders.hint";
    case "/admin/edit-orders": return "admin.tiles.editOrders.hint";
    case "/admin/roles": return "admin.tiles.roles.hint";
    case "/admin/ops": return "admin.tiles.ops.hint";
    case "/admin/promotions": return "admin.tiles.promotions.hint";
    case "/admin/delivery-options": return "admin.tiles.deliveryOptions.hint";
    case "/admin/marketing": return "admin.tiles.marketing.hint";
    case "/admin/taxes": return "admin.tiles.taxes.hint";
    case "/admin/reports": return "admin.tiles.reports.hint";
    case "/admin/ai-studio": return "admin.tiles.aiStudio.hint";
    case "/admin/settings": return "admin.tiles.settings.hint";
    case "/admin/home-configure": return "admin.tiles.homeConfigure.hint";
    default: return "admin.tiles.unknown.hint";
  }
}

/** 🔑 Mapa href → featureKey (según tu matriz Starter/Pro/Full) */
function getFeatureKeyByHref(href: string):
  | 'kitchen' | 'cashier' | 'delivery' | 'menu' | 'waiter' | 'orders' | 'editOrders'
  | 'roles' | 'ops' | 'promotions' | 'deliveryOptions' | 'marketing' | 'taxes'
  | 'reports' | 'aiStudio' | 'settings' | 'homeConfigure'
  | null
{
  switch (href) {
    case "/admin/kitchen": return "kitchen";
    case "/admin/cashier": return "cashier";
    case "/admin/delivery": return "delivery";
    case "/admin/menu": return "menu";
    case "/admin/waiter": return "waiter";
    case "/admin/orders": return "orders";
    case "/admin/edit-orders": return "editOrders";
    case "/admin/roles": return "roles";
    case "/admin/ops": return "ops";
    case "/admin/promotions": return "promotions";
    case "/admin/delivery-options": return "deliveryOptions";
    case "/admin/marketing": return "marketing";
    case "/admin/taxes": return "taxes";
    case "/admin/reports": return "reports";
    case "/admin/ai-studio": return "aiStudio";
    case "/admin/settings": return "settings";
    case "/admin/home-configure": return "homeConfigure";
    default: return null;
  }
}

export default function AdminPage() {
  const { settings } = useTenantSettings();

  // ✅ Resolver idioma: 1) localStorage (tenant.language)  2) Firestore settings.language
  const lang = React.useMemo(() => {
    try {
      if (typeof window !== "undefined") {
        const ls = localStorage.getItem("tenant.language");
        if (ls) return ls;
      }
    } catch (_) {}
    return (settings as any)?.language;
  }, [settings]);

  // Helper local con fallback al texto original
  const tt = (key: string, fallback: string, vars?: Record<string, unknown>) => {
    const s = translate(lang, key, vars);
    return s === key ? fallback : s;
  };

  /** 🔒 Estado de features por plan (llamamos el hook una sola vez por feature) */
  const { allowed: allowKitchen }         = useFeature('kitchen');
  const { allowed: allowCashier }         = useFeature('cashier');
  const { allowed: allowDelivery }        = useFeature('delivery');
  const { allowed: allowMenu }            = useFeature('menu');
  const { allowed: allowWaiter }          = useFeature('waiter');
  const { allowed: allowOrders }          = useFeature('orders');
  const { allowed: allowEditOrders }      = useFeature('editOrders');
  const { allowed: allowRoles }           = useFeature('roles');
  const { allowed: allowOps }             = useFeature('ops');
  const { allowed: allowPromotions }      = useFeature('promotions');
  const { allowed: allowDeliveryOptions } = useFeature('deliveryOptions');
  const { allowed: allowMarketing }       = useFeature('marketing');
  const { allowed: allowTaxes }           = useFeature('taxes');
  const { allowed: allowReports }         = useFeature('reports');
  const { allowed: allowAiStudio }        = useFeature('aiStudio');
  const { allowed: allowSettings }        = useFeature('settings');
  const { allowed: allowHomeConfigure }   = useFeature('homeConfigure');

  const isAllowedByKey = (key: ReturnType<typeof getFeatureKeyByHref>) => {
    switch (key) {
      case 'kitchen': return allowKitchen;
      case 'cashier': return allowCashier;
      case 'delivery': return allowDelivery;
      case 'menu': return allowMenu;
      case 'waiter': return allowWaiter;
      case 'orders': return allowOrders;
      case 'editOrders': return allowEditOrders;
      case 'roles': return allowRoles;
      case 'ops': return allowOps;
      case 'promotions': return allowPromotions;
      case 'deliveryOptions': return allowDeliveryOptions;
      case 'marketing': return allowMarketing;
      case 'taxes': return allowTaxes;
      case 'reports': return allowReports;
      case 'aiStudio': return allowAiStudio;
      case 'settings': return allowSettings;
      case 'homeConfigure': return allowHomeConfigure;
      case null: default: return true; // si no hay mapeo, no bloquear
    }
  };

  return (
    <Protected>
      <AdminOnly>
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
            .admin-link {
              text-decoration: none;
              color: inherit;
            }
            .admin-subtle {
              color: #6c757d;
            }
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
                  {tt("admin.page.title", "Admin panel")}
                </h1>
                <p className="m-0 mt-2 admin-subtle" style={{ color: "rgba(255,255,255,.85)" }}>
                  {tt("admin.page.subtitle", "Quickly access management tools.")}
                </p>
              </div>
              <div className="d-flex flex-wrap gap-2">
                <span className="admin-chip">🔐 {tt("admin.page.badgeOnlyAdmin", "Only Admin")}</span>
                <span className="admin-chip">⚡ {tt("admin.page.badgeQuickAccess", "Quick access")}</span>
              </div>
            </div>
          </section>

          {/* Cuadrícula de accesos */}
          <section>
            <div className="row g-3 g-md-4">
              {TILES.map((t) => {
                const featureKey = getFeatureKeyByHref(t.href);
                if (!isAllowedByKey(featureKey)) return null;

                const titleKey = getTitleKeyByHref(t.href);
                const hintKey = getHintKeyByHref(t.href);

                return (
                  <div key={t.href} className="col-12 col-sm-6 col-lg-4 col-xxl-3">
                    <Link href={t.href} className="admin-link">
                      <div className="card admin-card h-100 shadow-sm">
                        <div className="card-body d-flex flex-column gap-3">
                          <div className="d-flex align-items-center gap-3">
                            <div className="admin-emoji" aria-hidden>{t.emoji}</div>
                            <div>
                              <div className="h5 m-0">{tt(titleKey, t.title)}</div>
                              <div className="small text-muted">{t.subtitle}</div>
                            </div>
                          </div>
                          {t.hint && <p className="mb-0 admin-subtle">{tt(hintKey, t.hint)}</p>}
                          <div className="mt-auto d-flex justify-content-between align-items-center">
                            <span className="text-primary fw-semibold">{tt("admin.page.open", "Open")}</span>
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
      </AdminOnly>
    </Protected>
  );
}
