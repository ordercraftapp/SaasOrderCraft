// src/app/(tenant)/[tenantId]/app/orders/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import Protected from "@/app/(tenant)/[tenantId]/components/Protected";
import { useAuth } from "@/app/(tenant)/[tenantId]/app/providers";
import { useFmtQ } from "@/lib/settings/money";

// i18n
import { t, getLang } from "@/lib/i18n/t";
import { useTenantSettings } from "@/lib/settings/hooks";

/* Tipos y helpers... (idénticos a tu versión) */
type FirestoreTS = { seconds?: number; nanoseconds?: number } | Date | null | undefined;
type OpsOption = { groupName: string; selected: Array<{ name: string; priceDelta?: number; priceDeltaCents?: number }> };
type OpsAddon = { name: string; price?: number; priceCents?: number };
type OpsGroupItem = { id: string; name: string; priceDelta?: number; priceDeltaCents?: number };
type OpsGroup = { groupId: string; groupName: string; type?: "single" | "multiple"; items: OpsGroupItem[] };
type OpsItem = {
  menuItemId: string; menuItemName?: string; quantity: number; options?: OpsOption[];
  addons?: OpsAddon[]; optionGroups?: OpsGroup[]; unitPrice?: number; unitPriceCents?: number;
  basePrice?: number; basePriceCents?: number; price?: number; priceCents?: number; totalCents?: number;
  menuItem?: { price?: number; priceCents?: number } | null;
};
type LegacyLine = { itemId?: string; name?: string; qty?: number; unitPriceCents?: number; totalCents?: number };
type Order = {
  id: string; status?: string; currency?: string; createdAt?: FirestoreTS; updatedAt?: FirestoreTS; notes?: string | null;
  items?: OpsItem[]; amounts?: { subtotal: number; tax?: number; serviceFee?: number; discount?: number; tip?: number; total: number } | null;
  lines?: LegacyLine[]; totals?: { totalCents?: number } | null;
  createdBy?: { uid?: string; email?: string | null } | null; userEmail?: string | null; userEmail_lower?: string | null;
  contact?: { email?: string | null } | null; invoiceNumber?: string | null; invoiceDate?: FirestoreTS;
};
type ApiList = { ok?: boolean; orders?: Order[]; error?: string };

function tsToDate(ts: any): Date | null { /* igual que tu helper */ 
  if (!ts) return null;
  if (ts instanceof Date && !isNaN(ts.getTime())) return ts;
  if (typeof ts?.toDate === "function") { const d = ts.toDate(); return d instanceof Date && !isNaN(d.getTime()) ? d : null; }
  if (typeof ts === "object") {
    const seconds = ts.seconds ?? ts._seconds ?? ts.$seconds ?? null;
    const nanos = ts.nanoseconds ?? ts._nanoseconds ?? ts.nanos ?? 0;
    if (seconds != null) { const d = new Date(seconds * 1000 + Math.floor((nanos || 0) / 1e6)); if (!isNaN(d.getTime())) return d; }
    const iso = ts.$date ?? ts.iso ?? ts.date ?? null;
    if (typeof iso === "string") { const d = new Date(iso); if (!isNaN(d.getTime())) return d; }
  }
  if (typeof ts === "string") { const d = new Date(ts); if (!isNaN(d.getTime())) return d; const n = Number(ts); if (Number.isFinite(n)) { const d2 = new Date(n > 1e12 ? n : n * 1000); if (!isNaN(d2.getTime())) return d2; } return null; }
  if (typeof ts === "number") { const d = new Date(ts > 1e12 ? ts : ts * 1000); return isNaN(d.getTime()) ? null : d; }
  return null;
}
const toNum = (x: any) => (Number.isFinite(Number(x)) ? Number(x) : undefined);
const priceDeltaQ = (x: any) => (toNum(x?.priceDelta) ?? (toNum(x?.priceDeltaCents) ?? 0) / 100) || 0;
const priceQ = (x: any) => (toNum(x?.price) ?? (toNum(x?.priceCents) ?? 0) / 100) || 0;
const perUnitAddonsQ = (it: any) => {
  let s = 0;
  if (Array.isArray(it?.optionGroups)) for (const g of it.optionGroups) for (const og of (g?.items || [])) s += priceDeltaQ(og);
  if (Array.isArray(it?.options)) for (const g of it.options) for (const sel of (g?.selected || [])) s += priceDeltaQ(sel);
  if (Array.isArray(it?.addons)) for (const ad of it.addons) s += priceQ(ad);
  return s;
};
const baseUnitPriceQ = (it: any) => {
  const cands = [it?.basePrice, it?.basePriceCents && it.basePriceCents / 100, it?.unitPrice, it?.unitPriceCents && it.unitPriceCents / 100, it?.price, it?.priceCents && it.priceCents / 100, it?.menuItem?.priceCents && it.menuItem.priceCents / 100, it?.menuItem?.price];
  for (const v of cands) if (toNum(v) !== undefined) return Number(v);
  const qty = Number(it?.quantity || 1); const totC = toNum(it?.totalCents);
  if (totC !== undefined && qty > 0) return Math.max(0, totC / 100 / qty - perUnitAddonsQ(it));
  return 0;
};
const lineTotalOpsQ = (it: any) => (toNum(it?.totalCents) ?? 0) ? Number(it.totalCents) / 100 : (baseUnitPriceQ(it) + perUnitAddonsQ(it)) * Number(it?.quantity || 1);
const computeFromItems = (o: Order) => {
  const items = Array.isArray(o.items) ? o.items : [];
  const subtotal = items.reduce((acc, it) => acc + lineTotalOpsQ(it), 0);
  const tip = Number(o.amounts?.tip || 0);
  const total = Number.isFinite(Number(o.amounts?.total)) ? Number(o.amounts!.total) : subtotal + tip;
  return { subtotal, total };
};
const orderTotal = (o: Order) => {
  if (o.amounts && typeof o.amounts.total === "number") return Number(o.amounts.total || 0);
  const cents = o.totals?.totalCents ?? (Array.isArray(o.lines) ? o.lines.reduce((a, l) => a + (Number(l.totalCents || 0)), 0) : 0);
  const legacy = (Number(cents) || 0) / 100;
  if (!legacy && Array.isArray(o.items) && o.items.length) return computeFromItems(o).total;
  return legacy;
};
const fmtDate = (ts?: FirestoreTS) => { const d = tsToDate(ts || null); return d ? `${d.toLocaleDateString()} ${d.toLocaleTimeString()}` : "-"; };
const lineName = (l: LegacyLine) => (l.name && String(l.name)) || (l.itemId && `Item ${l.itemId}`) || "Item";
type StatusSnake = "cart" | "placed" | "kitchen_in_progress" | "kitchen_done" | "ready_to_close" | "assigned_to_courier" | "on_the_way" | "delivered" | "closed" | "cancelled";
const toSnakeStatus = (s: string): StatusSnake => {
  const snake = s?.includes("_") ? s : s?.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
  const alias: Record<string, StatusSnake> = { ready: "ready_to_close", served: "ready_to_close", completed: "closed", ready_for_delivery: "assigned_to_courier", out_for_delivery: "on_the_way" };
  return (alias[snake] ?? (snake as StatusSnake)) || "placed";
};
const STATUS_LABEL_KEYS: Record<StatusSnake, string> = {
  cart: "track.status.cart",
  placed: "track.status.received",
  kitchen_in_progress: "track.status.inKitchen",
  kitchen_done: "track.status.kitchenReady",
  ready_to_close: "track.status.readyToClose",
  assigned_to_courier: "track.status.assigned",
  on_the_way: "track.status.onTheWay",
  delivered: "track.status.delivered",
  closed: "track.status.closed",
  cancelled: "track.status.cancelled",
};
const statusLabel = (lang: string, s?: string) => t(lang, STATUS_LABEL_KEYS[toSnakeStatus(String(s || "placed"))]);

function ClientOrdersPageInner() {
  const { tenantId } = useParams<{ tenantId: string }>(); // tenancyUpdate: tenantId desde ruta segmentada
  const { user, idToken } = useAuth();
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [orders, setOrders] = useState<Order[]>([]);
  const [openId, setOpenId] = useState<string | null>(null);

  const { settings } = useTenantSettings();
  const rawLang =
    (settings as any)?.language ??
    (typeof window !== "undefined" ? localStorage.getItem("tenant.language") || undefined : undefined);
  const lang = getLang(rawLang);

  const fmtQ = useFmtQ();

  useEffect(() => {
    if (!tenantId) return; // tenancyUpdate: guard de tenant
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setErr(null);

        const headers: HeadersInit = {};
        if (idToken) headers["Authorization"] = `Bearer ${idToken}`;

        // tenancyUpdate: API con prefijo de tenant
        const res = await fetch(`/${tenantId}/app/api/orders?limit=200`, {
          cache: "no-store",
          headers,
        });
        const data: ApiList = await res.json().catch(() => ({} as any));
        if (!res.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${res.status}`);

        const uid = user?.uid || "";
        const mail = (user as any)?.email?.toLowerCase() || "";

        const mine = (data.orders || []).filter((o) => {
          const byUid = (o.createdBy?.uid || "") === uid;
          const byMail =
            (o.userEmail || "").toLowerCase() === mail ||
            (o.userEmail_lower || "").toLowerCase() === mail ||
            (o.createdBy?.email || "").toLowerCase() === mail ||
            (o.contact?.email || "").toLowerCase() === mail;
          return byUid || byMail;
        });

        mine.sort((a, b) => {
          const da = tsToDate(a.createdAt)?.getTime() ?? 0;
          const db = tsToDate(b.createdAt)?.getTime() ?? 0;
          return db - da;
        });

        if (alive) setOrders(mine);
      } catch (e: any) {
        if (alive) setErr(e?.message || "Could not load orders");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [tenantId, user?.uid, (user as any)?.email, idToken]);

  const totalOrders = orders.length;

  return (
    <div className="container py-4">
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h1 className="h5 m-0">{t(lang, "orders.title")}</h1>
        <span className="text-muted small">{t(lang, "orders.totalPrefix")} {totalOrders}</span>
      </div>

      {loading && <div className="alert alert-info">{t(lang, "orders.loading")}</div>}
      {err && <div className="alert alert-danger">{t(lang, "common.errorPrefix")} {err}</div>}

      {!loading && !err && totalOrders === 0 && (
        <div className="alert alert-secondary">
          {t(lang, "orders.empty.before")}{" "}
          {/* tenancyUpdate: Link con prefijo tenant */}
          <Link href={`/${tenantId}/app/menu`}>{t(lang, "orders.menuLink")}</Link>{" "}
          {t(lang, "orders.empty.after")}
        </div>
      )}

      {!loading && !err && totalOrders > 0 && (
        <div className="list-group">
          {orders.map((o) => {
            const total = orderTotal(o);
            const isOpen = openId === o.id;
            const closed = ["closed", "cancelled"].includes(String(o.status || "").toLowerCase());
            const pillClass = closed ? "bg-danger" : "bg-primary";

            const computed = !o.amounts && Array.isArray(o.items) && o.items.length
              ? computeFromItems(o)
              : null;

            return (
              <div key={o.id} className="list-group-item p-0 border-0 mb-3">
                <div className="card shadow-sm">
                  <div className="card-body d-flex flex-column flex-md-row justify-content-between align-items-start align-items-md-center">
                    <div className="me-md-3">
                      <div className="d-flex align-items-center flex-wrap gap-2">
                        <span className="fw-semibold">{t(lang, "orders.order")} #{o.id.slice(0, 6)}</span>
                        <span className={`badge rounded-pill ${pillClass}`}>{statusLabel(lang, o.status)}</span>
                      </div>
                      <div className="small text-muted mt-1">{t(lang, "orders.date")}: {fmtDate(o.createdAt)}</div>

                      {(o.invoiceNumber || o.invoiceDate) && (
                        <div className="small text-muted">
                          {t(lang, "orders.invoice")}: {o.invoiceNumber || "-"}{o.invoiceDate ? ` • ${fmtDate(o.invoiceDate)}` : ""}
                        </div>
                      )}
                    </div>
                    <div className="mt-2 mt-md-0 fw-bold">
                      {fmtQ(total)}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="card-footer d-flex gap-2">
                    <button
                      type="button"
                      className="btn btn-outline-secondary btn-sm"
                      onClick={() => setOpenId(isOpen ? null : o.id)}
                    >
                      {isOpen ? t(lang, "orders.hideDetails") : t(lang, "orders.viewDetails")}
                    </button>
                    {/* tenancyUpdate: Link con prefijo tenant */}
                    <Link href={`/${tenantId}/app/orders/${o.id}`} className="btn btn-outline-primary btn-sm">
                      {t(lang, "orders.openShare")}
                    </Link>
                  </div>

                  {/* Detalle inline expandible (sin cambios funcionales) */}
                  {isOpen && (
                    <div className="card-footer bg-white">
                      {Array.isArray(o.items) && o.items.length > 0 && (
                        <div className="mb-3">
                          <div className="fw-semibold mb-2">{t(lang, "orders.products")}</div>
                          <ul className="list-group">
                            {o.items.map((it, idx) => {
                              const lineTotal = lineTotalOpsQ(it);
                              const qty = Number(it.quantity || 1);
                              return (
                                <li className="list-group-item" key={`${it.menuItemId}-${idx}`}>
                                  <div className="d-flex justify-content-between">
                                    <div>
                                      <div className="fw-semibold">{it.menuItemName || it.menuItemId}</div>
                                      {/* addons */}
                                      {Array.isArray(it.addons) && it.addons.length > 0 && (
                                        <ul className="small text-muted mt-1 ps-3">
                                          {it.addons.map((ad, ai) => {
                                            const q = priceQ(ad);
                                            return (
                                              <li key={ai}>
                                                {t(lang, "orders.addonTag")} {ad.name}
                                                {q ? ` — ${fmtQ(q)}` : ""}
                                              </li>
                                            );
                                          })}
                                        </ul>
                                      )}
                                      {/* optionGroups.items */}
                                      {Array.isArray(it.optionGroups) && it.optionGroups.some(g => (g.items || []).length > 0) && (
                                        <ul className="small text-muted mt-1 ps-3">
                                          {it.optionGroups.map((g, gi) => {
                                            const list = (g.items || []);
                                            if (!list.length) return null;
                                            const rows = list.map((og) => {
                                              const d = priceDeltaQ(og);
                                              return `${og.name}${d ? ` (${fmtQ(d)})` : ""}`;
                                            }).join(", ");
                                            return <li key={gi}><span className="fw-semibold">{g.groupName}:</span> {rows}</li>;
                                          })}
                                        </ul>
                                      )}
                                      {/* options (compat) */}
                                      {Array.isArray(it.options) && it.options.length > 0 && (
                                        <ul className="small text-muted mt-1 ps-3">
                                          {it.options.map((g, gi) => {
                                            const rows = (g.selected || []).map((s) => {
                                              const d = priceDeltaQ(s);
                                              return `${s.name}${d ? ` (${fmtQ(d)})` : ""}`;
                                            }).join(", ");
                                            return <li key={gi}><span className="fw-semibold">{g.groupName}:</span> {rows}</li>;
                                          })}
                                        </ul>
                                      )}
                                      {/* ninguno */}
                                      {!((it.addons && it.addons.length) ||
                                         (it.optionGroups && it.optionGroups.some(g => (g.items || []).length > 0)) ||
                                         (it.options && it.options.length)) && (
                                        <div className="small text-muted">{t(lang, "orders.noAddons")}</div>
                                      )}
                                    </div>
                                    <div className="ms-3 text-nowrap">
                                      {fmtQ(lineTotal)}
                                      <div className="small text-muted text-end">x{qty}</div>
                                    </div>
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      )}

                      {Array.isArray(o.lines) && o.lines.length > 0 && (
                        <div className="mb-3">
                          <div className="fw-semibold mb-2">{t(lang, "orders.products")}</div>
                          <ul className="list-group">
                            {o.lines.map((l, idx) => {
                              const qty = Number(l.qty || 1);
                              const unitQ = Number(l.unitPriceCents || 0) / 100;
                              const totalQ = typeof l.totalCents === "number" ? l.totalCents / 100 : Math.max(0, unitQ * qty);
                              return (
                                <li className="list-group-item" key={idx}>
                                  <div className="d-flex justify-content-between">
                                    <div>
                                      <div className="fw-semibold">{lineName(l)}</div>
                                      <div className="small text-muted">x{qty}</div>
                                    </div>
                                    <div className="ms-3 text-nowrap">{fmtQ(totalQ)}</div>
                                  </div>
                                </li>
                              );
                            })}
                          </ul>
                        </div>
                      )}

                      {/* Totales */}
                      <div className="row g-2">
                        {o.notes ? (
                          <div className="col-12">
                            <div className="small">
                              <span className="text-muted">{t(lang, "orders.notes")}: </span>
                              {o.notes}
                            </div>
                          </div>
                        ) : null}
                        {o.amounts ? (
                          <div className="col-12">
                            <div className="d-flex flex-column align-items-end gap-1">
                              <div className="small text-muted">
                                {t(lang, "orders.subtotal")}: <span className="fw-semibold">{fmtQ(Number(o.amounts.subtotal || 0))}</span>
                              </div>
                              {!!o.amounts.tax && (
                                <div className="small text-muted">
                                  {t(lang, "orders.taxes")}: <span className="fw-semibold">{fmtQ(Number(o.amounts.tax || 0))}</span>
                                </div>
                              )}
                              {!!o.amounts.serviceFee && (
                                <div className="small text-muted">
                                  {t(lang, "orders.service")}: <span className="fw-semibold">{fmtQ(Number(o.amounts.serviceFee || 0))}</span>
                                </div>
                              )}
                              {!!o.amounts.discount && (
                                <div className="small text-muted">
                                  {t(lang, "orders.discount")}: <span className="fw-semibold">−{fmtQ(Number(o.amounts.discount || 0))}</span>
                                </div>
                              )}
                              {!!o.amounts.tip && (
                                <div className="small text-muted">
                                  {t(lang, "orders.tip")}: <span className="fw-semibold">{fmtQ(Number(o.amounts.tip || 0))}</span>
                                </div>
                              )}
                              <div className="mt-1">
                                {t(lang, "orders.total")}: <span className="fw-bold">{fmtQ(Number(o.amounts.total || total))}</span>
                              </div>
                            </div>
                          </div>
                        ) : (
                          <div className="col-12">
                            <div className="d-flex flex-column align-items-end gap-1">
                              <div className="small text-muted">
                                {t(lang, "orders.subtotal")}: <span className="fw-semibold">{fmtQ(Number((computeFromItems(o) || {}).subtotal || 0))}</span>
                              </div>
                              <div className="mt-1">
                                {t(lang, "orders.total")}: <span className="fw-bold">{fmtQ(Number(orderTotal(o)))}</span>
                              </div>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-4">
        {/* tenancyUpdate: Link con prefijo tenant */}
        <Link href={`/${tenantId}/app/menu`} className="btn btn-outline-secondary">
          {t(lang, "orders.backToMenu")}
        </Link>
      </div>
    </div>
  );
}

export default function ClientOrdersPage() {
  return (
    <Protected>
      <ClientOrdersPageInner />
    </Protected>
  );
}
