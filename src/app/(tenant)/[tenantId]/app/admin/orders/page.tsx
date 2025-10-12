// src/app/(tenant)/[tenantId]/app/admin/orders/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import Protected from "@/app/(tenant)/[tenantId]/components/Protected";
import AdminOnly from "@/app/(tenant)/[tenantId]/components/AdminOnly";
import ToolGate from "@/components/ToolGate";

/** ✅ Currency centralizado (respeta SettingsProvider) */
import { useFmtQ } from "@/lib/settings/money";

/* 🔤 i18n (igual patrón que Kitchen/Ops) */
import { t as translate } from "@/lib/i18n/t";
import { useTenantSettings } from "@/lib/settings/hooks";

/* ------------------- Tipos base ------------------- */
type FirestoreTimestamp =
  | { seconds: number; nanoseconds: number }
  | Date
  | null
  | undefined;

type OptionItem = {
  id?: string;
  name?: string;
  price?: number;
  priceCents?: number;
  priceDelta?: number;
  priceDeltaCents?: number;
  priceExtra?: number;
  priceExtraCents?: number;
};

type OrderLine = {
  menuItemId?: string;
  menuItemName?: string;
  name?: string;
  quantity?: number;
  basePrice?: number;               // checkout nuevo
  unitPrice?: number;               // compat
  unitPriceCents?: number;          // compat
  price?: number;                   // compat
  priceCents?: number;              // compat
  totalCents?: number;              // legacy
  lineTotal?: number;               // checkout nuevo
  addons?: Array<string | { name?: string; price?: number; priceCents?: number }>;
  optionGroups?: Array<{
    groupId?: string;
    groupName?: string;
    type?: "single" | "multiple";
    items: OptionItem[];
  }>;
  options?: Array<{ groupName: string; selected: OptionItem[] }>; // legacy
  menuItem?: { price?: number; priceCents?: number } | null;      // compat
};

type OrderDoc = {
  id: string;
  orderNumber?: string | number;
  type?: "dine_in" | "takeaway" | "delivery";
  status?: string;
  currency?: string;
  tableNumber?: string | null;
  notes?: string | null;
  /** 🆕 nota de modificación (cuando se eliminan items en Ops) */
  modifiedNote?: string | null;
  createdAt?: FirestoreTimestamp;
  updatedAt?: FirestoreTimestamp;
  createdBy?: { uid?: string; email?: string | null } | null;
  userEmail?: string | null;
  userEmail_lower?: string | null;
  contact?: { email?: string | null } | null;

  items?: OrderLine[];
  lines?: Array<{ totalCents?: number }>;

  amounts?: { subtotal?: number; tax?: number; serviceFee?: number; discount?: number; tip?: number; total?: number } | null;
  totals?: { totalCents?: number; subtotalCents?: number } | null;
  orderTotal?: number | null;

  orderInfo?: {
    type?: "dine-in" | "delivery";
    table?: string;
    notes?: string;
    address?: string;
    phone?: string;
    delivery?: "pending" | "inroute" | "delivered";
    courierName?: string | null;
  } | null;

  channel?: string;
  origin?: string;
};

type ApiListResponse = { ok?: boolean; orders?: OrderDoc[]; error?: string };

/* ------------------- Utils ------------------- */
function tsToDate(ts: any): Date | null {
  if (!ts) return null;
  if (ts instanceof Date) return isNaN(ts.getTime()) ? null : ts;
  if (typeof ts?.toDate === "function") {
    const d = ts.toDate();
    return d instanceof Date && !isNaN(d.getTime()) ? d : null;
  }
  if (typeof ts === "object") {
    const seconds = ts.seconds ?? ts._seconds ?? ts.$seconds ?? null;
    const nanos = ts.nanoseconds ?? ts._nanoseconds ?? ts.nanos ?? 0;
    if (seconds != null) {
      const ms = seconds * 1000 + Math.floor((nanos || 0) / 1e6);
      const d = new Date(ms);
      if (!isNaN(d.getTime())) return d;
    }
    const iso = ts.$date ?? ts.iso ?? ts.date ?? null;
    if (typeof iso === "string") {
      const d = new Date(iso);
      if (!isNaN(d.getTime())) return d;
    }
  }
  if (typeof ts === "string") {
    const d = new Date(ts);
    if (!isNaN(d.getTime())) return d;
    const n = Number(ts);
    if (Number.isFinite(n)) {
      const ms = n > 1e12 ? n : n * 1000;
      const d2 = new Date(ms);
      if (!isNaN(d2.getTime())) return d2;
    }
    return null;
  }
  if (typeof ts === "number") {
    const ms = ts > 1e12 ? ts : ts * 1000;
    const d = new Date(ms);
    return isNaN(d.getTime()) ? null : d;
  }
  return null;
}

function formatDate(ts: FirestoreTimestamp): string {
  const d = tsToDate(ts);
  if (!d) return "-";
  return `${d.toLocaleDateString()} ${d.toLocaleTimeString()}`;
}
function isClosed(status?: string): boolean {
  const s = (status || "").toLowerCase();
  return s === "closed" || s === "cancelled";
}

/* ⚠️ Quitamos helpers de moneda locales (curSymbol / fmtMoney) porque ahora usamos useFmtQ */

const toNum = (x: any) => (Number.isFinite(Number(x)) ? Number(x) : undefined);
const centsToQ = (c?: number) => (Number.isFinite(c) ? Number(c) / 100 : 0);

function getQty(l?: OrderLine): number {
  return Number(l?.quantity ?? 1) || 1;
}
function getName(l?: OrderLine): string {
  return String(l?.menuItemName ?? l?.name ?? "Item");
}
function extractDeltaQ(x: OptionItem | any): number {
  const a = toNum(x?.priceDelta); if (a !== undefined) return a;
  const b = toNum(x?.priceExtra); if (b !== undefined) return b;
  const ac = toNum(x?.priceDeltaCents); if (ac !== undefined) return ac / 100;
  const bc = toNum(x?.priceExtraCents); if (bc !== undefined) return bc / 100;
  const p = toNum(x?.price); if (p !== undefined) return p;
  const pc = toNum(x?.priceCents); if (pc !== undefined) return pc / 100;
  return 0;
}
function baseUnitPriceQ(l: OrderLine): number {
  const base = toNum(l.basePrice);
  if (base !== undefined) return base;
  const upc = toNum(l.unitPriceCents); if (upc !== undefined) return upc / 100;
  const up = toNum(l.unitPrice);       if (up !== undefined) return up;
  const pc = toNum(l.priceCents);      if (pc !== undefined) return pc / 100;
  const p  = toNum(l.price);           if (p  !== undefined) return p;
  const miC = toNum(l.menuItem?.priceCents); if (miC !== undefined) return miC / 100;
  const mi  = toNum(l.menuItem?.price);      if (mi  !== undefined) return mi;
  const tC = toNum(l.totalCents), q = getQty(l);
  if (tC !== undefined && q > 0) {
    const per = tC / 100 / q;
    const addons = perUnitAddonsQ(l);
    return Math.max(0, per - addons);
  }
  return 0;
}
function perUnitAddonsQ(l: OrderLine): number {
  let sum = 0;
  if (Array.isArray(l.optionGroups)) {
    for (const g of l.optionGroups) {
      for (const it of (g.items || [])) sum += extractDeltaQ(it);
    }
  }
  if (Array.isArray(l.options)) {
    for (const g of l.options) {
      for (const it of (g.selected || [])) sum += extractDeltaQ(it);
    }
  }
  for (const bucket of ["addons"] as const) {
    const arr = (l as any)[bucket];
    if (Array.isArray(arr)) {
      for (const it of arr) {
        if (typeof it === "string") continue;
        const p =
          toNum(it?.price) ??
          (toNum(it?.priceCents) !== undefined ? Number(it!.priceCents) / 100 : undefined);
        sum += extractDeltaQ(it) || (p ?? 0);
      }
    }
  }
  return sum;
}
function lineTotalQ(l: OrderLine): number {
  if (toNum(l.lineTotal) !== undefined) return Number(l.lineTotal);
  if (toNum(l.totalCents) !== undefined) return Number(l.totalCents) / 100;
  const q = getQty(l);
  return (baseUnitPriceQ(l) + perUnitAddonsQ(l)) * q;
}
function orderTotalQ(o: OrderDoc): number {
  if (toNum(o.amounts?.total) !== undefined) return Number(o.amounts!.total);
  if (toNum(o.orderTotal) !== undefined) return Number(o.orderTotal);
  if (toNum(o.totals?.totalCents) !== undefined) return centsToQ(o.totals!.totalCents!);
  if (Array.isArray(o.lines) && o.lines.length) return o.lines.reduce((acc, l) => acc + centsToQ(l.totalCents), 0);
  const lines = (o.items || []);
  if (lines.length) return lines.reduce((acc, l) => acc + lineTotalQ(l), 0);
  return 0;
}

function displayType(o: OrderDoc): "dine_in" | "delivery" | "-" {
  const t = o.orderInfo?.type?.toLowerCase?.();
  if (t === "delivery") return "delivery";
  if (t === "dine-in") return "dine_in";
  if (o.type === "delivery" || o.type === "dine_in") return o.type as "delivery" | "dine_in";
  return "-";
}

/* 🔹 Label legible para sub-estado delivery (ahora i18n-aware) */
function deliverySubstateLabel(tt: (k: string, fb: string) => string, s?: string | null) {
  const v = String(s || "").toLowerCase();
  if (v === "pending") return tt("admin.orders.delivery.pending", "Pending");
  if (v === "inroute") return tt("admin.orders.delivery.inroute", "En route");
  if (v === "delivered") return tt("admin.orders.delivery.delivered", "Delivered");
  return "-";
}

/* ------------------- Página interna ------------------- */
function AdminOrdersPageInner() {
  const [orders, setOrders] = useState<OrderDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [emailFilter, setEmailFilter] = useState("");
  const [open, setOpen] = useState<Record<string, boolean>>({});

  /** ✅ formateador de moneda del tenant */
  const fmtQ = useFmtQ();

  /* 🔤 idioma */
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

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        setLoading(true);
        // ✅ TENANT API: usar /app/api en lugar de /api
        const res = await fetch(`/app/api/orders?limit=100`, { cache: "no-store" });
        const data: ApiListResponse = await res.json();
        if (!res.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${res.status}`);
        if (isMounted) setOrders(data.orders || []);
      } catch (e: any) {
        if (isMounted) setErr(e?.message || tt("admin.orders.err.loading", "Error loading orders"));
      } finally {
        if (isMounted) setLoading(false);
      }
    })();
    return () => { isMounted = false; };
  }, []);

  // Filtro por email
  const filtered = useMemo(() => {
    const q = emailFilter.trim().toLowerCase();
    if (!q) return orders;
    return orders.filter((o) => {
      const a = (o.userEmail || "").toLowerCase();
      const aLower = (o.userEmail_lower || "").toLowerCase();
      const b = (o.createdBy?.email || "").toLowerCase();
      const c = (o.contact?.email || "").toLowerCase();
      return a.includes(q) || aLower.includes(q) || b.includes(q) || c.includes(q);
    });
  }, [orders, emailFilter]);

  const sorted = useMemo(() => {
    return [...filtered].sort((a, b) => {
      const da = tsToDate(a.createdAt)?.getTime() ?? 0;
      const db = tsToDate(b.createdAt)?.getTime() ?? 0;
      return db - da;
    });
  }, [filtered]);

  const counts = useMemo(() => {
    let active = 0, closed = 0;
    for (const o of sorted) isClosed(o.status) ? closed++ : active++;
    return { active, closed };
  }, [sorted]);

  function toggle(id: string) {
    setOpen((m) => ({ ...m, [id]: !m[id] }));
  }

  return (
    <div className="container py-4">
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h1 className="h4 m-0">{tt("admin.orders.title", "Orders (Admin)")}</h1>
        <div className="d-flex align-items-center gap-2">
          <span className="badge rounded-pill bg-primary">
            {tt("admin.orders.counts.active", "Active")}: {counts.active}
          </span>
          <span className="badge rounded-pill bg-danger">
            {tt("admin.orders.counts.closed", "Closed")}: {counts.closed}
          </span>
        </div>
      </div>

      <div className="card mb-4 shadow-sm">
        <div className="card-body">
          <div className="row g-2 align-items-end">
            <div className="col-12 col-md-6">
              <label htmlFor="emailFilter" className="form-label mb-1">
                {tt("admin.orders.filter.email.label", "Filter by user email")}
              </label>
              <div className="input-group">
                <span className="input-group-text">@</span>
                <input
                  id="emailFilter"
                  type="text"
                  className="form-control"
                  placeholder={tt("admin.orders.filter.email.ph", "user@email.com")}
                  value={emailFilter}
                  onChange={(e) => setEmailFilter(e.target.value)}
                />
                {emailFilter && (
                  <button className="btn btn-outline-secondary" type="button" onClick={() => setEmailFilter("")}>
                    {tt("admin.orders.filter.clear", "Clear")}
                  </button>
                )}
              </div>
              <div className="form-text">
                {tt("admin.orders.filter.email.help", "User email search.")}
              </div>
            </div>
          </div>
        </div>
      </div>

      {loading && <div className="alert alert-info">{tt("admin.orders.loading", "Loading orders…")}</div>}
      {err && <div className="alert alert-danger">{tt("common.errorPrefix", "Error:")} {err}</div>}

      {!loading && !err && (
        <ul className="list-group">
          {sorted.map((o) => {
            const closed = isClosed(o.status);
            const pillClass = closed ? "bg-danger" : "bg-primary";
            const type = displayType(o);
            const typeLabel =
              type === "dine_in"
                ? tt("admin.orders.type.dinein", "Dine-in")
                : type === "delivery"
                ? tt("admin.orders.type.delivery", "Delivery")
                : "-";
            const number = o.orderNumber ?? o.id.slice(0, 6);
            const total = orderTotalQ(o);
            const d = formatDate(o.createdAt);
            const email = o.userEmail || o.createdBy?.email || o.contact?.email || "-";
            const isOpen = !!open[o.id];

            return (
              <li key={o.id} className="list-group-item">
                {/* Encabezado (clic para expandir) */}
                <div className="d-flex flex-column flex-md-row align-items-start align-items-md-center justify-content-between">
                  <div className="me-3">
                    <div className="fw-semibold d-flex align-items-center flex-wrap gap-2">
                      <button
                        className="btn btn-sm btn-outline-secondary"
                        onClick={() => toggle(o.id)}
                        aria-expanded={isOpen}
                        aria-controls={`order-${o.id}`}
                      >
                        {isOpen ? "−" : "+"}
                      </button>
                      <span>#{number}</span>
                      <span className={`badge rounded-pill ${pillClass}`}>
                        {closed ? tt("admin.orders.badge.closed", "CLOSED") : tt("admin.orders.badge.active", "ACTIVE")}
                      </span>
                      <span className="badge text-bg-light">{typeLabel}</span>
                    </div>
                    <div className="small text-muted mt-1">
                      {tt("admin.orders.date", "Date")}: {d}{" "}
                      {type === "dine_in" && (o.orderInfo?.table || o.tableNumber)
                        ? `• ${tt("admin.orders.table", "Table")}: ${o.orderInfo?.table || o.tableNumber}`
                        : ""}
                    </div>
                    <div className="small mt-1">
                      <span className="text-muted">{tt("admin.orders.user", "User")}: </span>
                      <span>{email}</span>
                    </div>
                  </div>

                  <div className="text-md-end mt-2 mt-md-0">
                    {/* ✅ ahora respeta currency global */}
                    <div className="fw-bold">{fmtQ(total)}</div>
                    {o.notes ? (
                      <div className="small text-muted text-wrap" style={{ maxWidth: 420 }}>
                        {tt("admin.orders.note", "Note")}: {o.notes}
                      </div>
                    ) : null}
                    {/* 🆕 Mostrar modifiedNote si existe */}
                    {o.modifiedNote ? (
                      <div className="small text-muted text-wrap" style={{ maxWidth: 420 }}>
                        {tt("admin.orders.modifiedNote", "Modified note")}: {o.modifiedNote}
                      </div>
                    ) : null}
                    <a
                      href={`/app/admin/orders/invoice/${o.id}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="btn btn-sm btn-outline-primary mt-2"
                      title={tt("admin.orders.printInvoice.title", "Print invoice")}
                    >
                      {tt("admin.orders.printInvoice", "Print invoice")}
                    </a>
                  </div>
                </div>

                {/* Detalle expandible */}
                {isOpen && (
                  <div id={`order-${o.id}`} className="mt-3">
                    {/* Bloque de delivery (solo si aplica) */}
                    {type === "delivery" && (o.orderInfo?.delivery || o.orderInfo?.courierName) ? (
                      <div className="mb-3">
                        <div className="d-flex flex-wrap align-items-center gap-2 small">
                          <span className="badge text-bg-secondary">
                            {tt("admin.orders.delivery.badge", "Delivery")}
                          </span>
                          {o.orderInfo?.delivery && (
                            <span className="badge text-bg-info">
                              {tt("admin.orders.delivery.status", "Status")}: {deliverySubstateLabel(tt, o.orderInfo?.delivery)}
                            </span>
                          )}
                          {o.orderInfo?.courierName && (
                            <span className="badge text-bg-dark">
                              {tt("admin.orders.delivery.courier", "Courier")}: {o.orderInfo.courierName}
                            </span>
                          )}
                        </div>
                      </div>
                    ) : null}

                    {(o.items?.length ? o.items : []).map((l, idx) => {
                      const qty = getQty(l);
                      const name = getName(l);
                      const baseUnit = baseUnitPriceQ(l);
                      const lineTotal = lineTotalQ(l);

                      return (
                        <div key={idx} className="small mb-2 border-top pt-2">
                          <div className="d-flex justify-content-between">
                            <div>• {qty} × {name}</div>
                            <div className="text-muted">({tt("admin.orders.each", "ea")}: {fmtQ(baseUnit)})</div>
                          </div>

                          {/* optionGroups (checkout) */}
                          {Array.isArray(l.optionGroups) && l.optionGroups.map((g, gi) => {
                            const rows = (g.items || []).map((it, ii) => {
                              const p = extractDeltaQ(it);
                              return <span key={ii}>{it?.name}{p ? ` (${fmtQ(p)})` : ""}{ii < (g.items!.length - 1) ? ", " : ""}</span>;
                            });
                            return rows.length ? (
                              <div key={gi} className="ms-3 text-muted">
                                <span className="fw-semibold">{g.groupName || tt("admin.orders.options", "Options")}:</span> {rows}
                              </div>
                            ) : null;
                          })}

                          {/* legacy options */}
                          {Array.isArray(l.options) && l.options.map((g, gi) => {
                            const rows = (g.selected || []).map((it, ii) => {
                              const p = extractDeltaQ(it);
                              return <span key={ii}>{it?.name}{p ? ` (${fmtQ(p)})` : ""}{ii < (g.selected!.length - 1) ? ", " : ""}</span>;
                            });
                            return rows.length ? (
                              <div key={`op-${gi}`} className="ms-3 text-muted">
                                <span className="fw-semibold">{g.groupName || tt("admin.orders.options", "Options")}:</span> {rows}
                              </div>
                            ) : null;
                          })}

                          {/* addons */}
                          {Array.isArray(l.addons) && l.addons.length > 0 && (
                            <div className="ms-3 text-muted">
                              <span className="fw-semibold">{tt("admin.orders.addons", "addons")}:</span>{" "}
                              {l.addons.map((ad, ai) => {
                                if (typeof ad === "string") {
                                  return (
                                    <span key={ai}>
                                      {ad}
                                      {ai < l.addons!.length - 1 ? ", " : ""}
                                    </span>
                                  );
                                }
                                const p =
                                  toNum(ad?.price) ??
                                  (toNum(ad?.priceCents) !== undefined ? Number(ad!.priceCents) / 100 : undefined);

                                return (
                                  <span key={ai}>
                                    {ad?.name}
                                    {p ? ` (${fmtQ(p)})` : ""}
                                    {ai < l.addons!.length - 1 ? ", " : ""}
                                  </span>
                                );
                              })}
                            </div>
                          )}

                          <div className="d-flex justify-content-between">
                            <span className="text-muted">{tt("admin.orders.lineSubtotal", "Line subtotal")}</span>
                            <span className="text-muted">{fmtQ(lineTotal)}</span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </li>
            );
          })}

          {sorted.length === 0 && (
            <li className="list-group-item text-center text-muted">
              {tt("admin.orders.empty", "No orders match the filter.")}
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

/* ------------------- Export default protegido ------------------- */
export default function AdminOrdersPage() {
  return (
    <Protected>
      <AdminOnly>
        {/* ✅ Guard de plan: Starter/Pro/Full */}
        <ToolGate feature="orders">
          <AdminOrdersPageInner />
        </ToolGate>
      </AdminOnly>
    </Protected>
  );
}
