"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import Protected from "@/app/(tenant)/[tenantId]/components/Protected";
import ToolGate from "@/components/ToolGate"; // 👈 se mantiene tu import
import { OnlyWaiter } from "@/app/(tenant)/[tenantId]/components/Only";
import "@/lib/firebase/client";
import { useAuth } from "@/app/(tenant)/[tenantId]/app/providers";
import {
  getFirestore,
  getDoc,
  setDoc,
  onSnapshot,
  query,
  where,
  orderBy,
  limit,
  Timestamp,
  Unsubscribe,
} from "firebase/firestore";

/** ✅ Currency centralizado (respeta settings) */
import { useFmtQ } from "@/lib/settings/money";

/** 🔤 i18n */
import { t as translate } from "@/lib/i18n/t";
import { useTenantSettings } from "@/lib/settings/hooks";

/** 🧩 Helpers tenant-aware (Web SDK) */
import { tCol, tDoc } from "@/lib/db";
import { useTenantId } from "@/lib/tenant/context";

// =================== Types ===================
type FirestoreTS = Timestamp | { seconds: number; nanoseconds?: number } | Date | null | undefined;

type OpsAddon = { name: string; price?: number };
type OpsGroupItem = { id: string; name: string; priceDelta?: number };
type OpsGroup = { groupId: string; groupName: string; type?: "single" | "multi"; items: OpsGroupItem[] };

type OrderItem = {
  menuItemId: string;
  menuItemName?: string;
  quantity: number;
  basePrice?: number;
  lineTotal?: number;
  addons?: OpsAddon[];
  optionGroups?: OpsGroup[];
};

type OrderDoc = {
  id: string;
  createdAt?: FirestoreTS;
  updatedAt?: FirestoreTS;
  status?: "placed" | "kitchen_in_progress" | "kitchen_done" | "ready_to_close" | "closed";
  statusHistory?: Array<{ at?: string; by?: string; from?: string; to?: string }>;
  orderInfo?: {
    type?: "dine-in" | "delivery" | "pickup";
    table?: string;
    notes?: string;
  };
  items?: OrderItem[];
  totals?: {
    currency?: string;
    subtotal?: number;
    tax?: number;
    tip?: number;
    discount?: number;
    deliveryFee?: number;
    grandTotalWithTax?: number;
    /** opcional en algunos pipelines */
    pricesIncludeTax?: boolean;
  } | null;
  totalsCents?: {
    currency?: string;
    itemsSubTotalCents?: number;
    itemsTaxCents?: number;
    grandTotalWithTaxCents?: number;
    tipCents?: number;
    discountCents?: number;
    deliveryFeeCents?: number;
  } | null;
  /** en algunos pipelines puede venir */
  taxProfile?: { pricesIncludeTax?: boolean } | null;
  taxSnapshot?: { pricesIncludeTax?: boolean } | null;

  invoiceNumber?: string | null;
  invoiceDate?: FirestoreTS;
};

type WaiterSettings = {
  numTables: number;
  updatedAt?: FirestoreTS;
  updatedBy?: string;
};

// =================== Helpers ===================
function tsToDate(ts: FirestoreTS): Date | null {
  if (!ts) return null;
  if (ts instanceof Date) return ts;
  if (typeof (ts as any)?.seconds === "number") {
    return new Date(((ts as any).seconds as number) * 1000);
  }
  if (ts instanceof Timestamp) return ts.toDate();
  return null;
}

function safeNum(n: any): number {
  const v = Number(n);
  return Number.isFinite(v) ? v : 0;
}

function sumLine(ln: OrderItem): number {
  if (typeof ln.lineTotal === "number") return ln.lineTotal;
  const qty = safeNum(ln.quantity || 1);
  const base = safeNum(ln.basePrice);
  const addons = (ln.addons || []).reduce((acc, a) => acc + safeNum(a.price), 0);
  const opts =
    (ln.optionGroups || []).reduce((acc, g) => {
      return acc + (g.items || []).reduce((acc2, it) => acc2 + safeNum(it.priceDelta), 0);
    }, 0);
  return (base + addons + opts) * qty;
}

function computeSubtotalFromItems(order?: OrderDoc): number | undefined {
  if (!order?.items || order.items.length === 0) return undefined;
  return order.items.reduce((acc, ln) => acc + sumLine(ln), 0);
}

// ➕ subtotal “fresco” siempre que haya items; si no, cae a totals/totalsCents
function getFreshSubtotal(order?: OrderDoc): number {
  const fromItems = computeSubtotalFromItems(order);
  if (typeof fromItems === "number") return fromItems;

  const fromTotals = pickAmount(order, "subtotal");
  return typeof fromTotals === "number" ? fromTotals : 0;
}

function pickAmount(
  order: OrderDoc | undefined,
  key: "subtotal" | "tax" | "tip" | "discount" | "deliveryFee" | "grandTotalWithTax"
): number | undefined {
  if (!order) return undefined;

  // 1) totals
  const t: any = order.totals || {};
  if (typeof t[key] === "number") return t[key] as number;

  // 2) totalsCents
  const c: any = order.totalsCents || {};
  const centsKey =
    key === "subtotal" ? "itemsSubTotalCents"
      : key === "tax" ? "itemsTaxCents"
      : key === "tip" ? "tipCents"
      : key === "discount" ? "discountCents"
      : key === "deliveryFee" ? "deliveryFeeCents"
      : key === "grandTotalWithTax" ? "grandTotalWithTaxCents"
      : undefined;

  if (centsKey && typeof c[centsKey] === "number") {
    return (c[centsKey] as number) / 100;
  }

  // 3) fallback específico para subtotal: computar desde ítems
  if (key === "subtotal") {
    const sub = computeSubtotalFromItems(order);
    if (typeof sub === "number") return sub;
  }

  return undefined;
}

/** 🔎 Detecta si los precios ya incluyen impuestos (pricesIncludeTax) */
function detectPricesIncludeTax(order?: OrderDoc): boolean {
  if (!order) return true; // ✅ por defecto NO sumar impuesto

  // 1) Señales explícitas (las más confiables)
  const explicit =
    order.totals?.pricesIncludeTax ??
    order.taxProfile?.pricesIncludeTax ??
    order.taxSnapshot?.pricesIncludeTax;
  if (typeof explicit === "boolean") return explicit;

  // 2) Fallback seguro: asumir que SÍ incluyen (evita sumar doble)
  return true;
}

// 🔁 usa siempre getFreshSubtotal si hay items; solo usa stored total si NO hay items
function computeGrandTotal(order?: OrderDoc): number | undefined {
  if (!order) return undefined;

  const hasItems = Array.isArray(order.items) && order.items.length > 0;
  const storedTotal = pickAmount(order, "grandTotalWithTax");
  if (!hasItems && typeof storedTotal === "number") return storedTotal;

  const sub = getFreshSubtotal(order);
  const includeTaxInPrice = detectPricesIncludeTax(order);

  // Si los precios incluyen impuesto, NO lo sumamos aparte.
  const tax = includeTaxInPrice ? 0 : (pickAmount(order, "tax") ?? 0);
  const tip = pickAmount(order, "tip") ?? 0;
  const fee = pickAmount(order, "deliveryFee") ?? 0;
  const disc = pickAmount(order, "discount") ?? 0;

  const total = sub + tax + tip + fee - disc;
  return Math.max(0, Number(total.toFixed(2)));
}

function updatedOrCreatedAt(d?: OrderDoc) {
  return tsToDate(d?.updatedAt) || tsToDate(d?.createdAt) || new Date(0);
}

const OPEN_STATUSES: OrderDoc["status"][] = [
  "placed",
  "kitchen_in_progress",
  "kitchen_done",
  "ready_to_close",
];

const STATUS_BADGE: Record<string, "secondary" | "warning" | "success" | "primary"> = {
  placed: "secondary",
  kitchen_in_progress: "warning",
  kitchen_done: "success",
  ready_to_close: "primary",
};

// Max items allowed in a Firestore "in" filter
const IN_FILTER_MAX = 30;

// 👉 URL base a donde quieres mandar al mesero al “Pick”
const PICK_TARGET_BASE = "/checkout-cards?type=dine-in&table=";

// =================== Page ===================
export default function WaiterPage() {
  const tenantId = useTenantId() as string; // tenant requerido en esta vista
  const db = useMemo(() => getFirestore(), []);
  const { user, flags } = useAuth(); // 🔒 antes: solo user — ahora usamos flags
  const [numTables, setNumTables] = useState<number>(12);
  const [loadingSettings, setLoadingSettings] = useState(true);

  // table -> order
  const [activeByTable, setActiveByTable] = useState<Record<string, OrderDoc | undefined>>({});
  const unsubRef = useRef<Unsubscribe[]>([]);
  const [selectedTable, setSelectedTable] = useState<string | null>(null);

  // ✅ formateador de moneda central (tenant)
  const fmtQ = useFmtQ();

  // 🔤 idioma (igual que kitchen/taxes)
  const { settings } = useTenantSettings();
  const lang = React.useMemo(() => {
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

  // 🔒 Habilitación real de efectos (sesión + tenant + rol waiter/admin)
  const enabled = !!user && !!tenantId && (flags?.isWaiter || flags?.isAdmin); // 🔒

  // ------------- Load & Save Settings -------------
  useEffect(() => {
    if (!tenantId || !enabled) return; // 🔒 no cargar nada si no está habilitado
    let mounted = true;
    (async () => {
      try {
        const snap = await getDoc(tDoc("settings", tenantId, "waiter"));
        if (snap.exists()) {
          const data = snap.data() as WaiterSettings;
          if (mounted && typeof data?.numTables === "number" && data.numTables > 0) {
            setNumTables(Math.min(200, Math.max(1, data.numTables)));
          }
        }
      } finally {
        if (mounted) setLoadingSettings(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [db, tenantId, enabled]); // 🔒 dep: enabled

  async function saveNumTables() {
    if (!tenantId || !enabled) return; // 🔒
    const safe = Math.min(200, Math.max(1, Number(numTables) || 1));
    await setDoc(
      tDoc("settings", tenantId, "waiter"),
      {
        numTables: safe,
        updatedAt: Timestamp.now(),
        updatedBy: user?.uid ?? null,
        tenantId,
      },
      { merge: true }
    );
    setNumTables(safe);
    armOrderListeners(safe);
  }

  // ------------- Live Orders per Table -------------
  useEffect(() => {
    // 🔒 si no está habilitado o aún no cargan settings, no montar listeners
    if (!tenantId || !enabled) return;
    if (!loadingSettings) {
      armOrderListeners(numTables);
    }
    return () => {
      unsubRef.current.forEach((u) => u && u());
      unsubRef.current = [];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingSettings, tenantId, enabled]); // 🔒 dep: enabled

  function armOrderListeners(count: number) {
    unsubRef.current.forEach((u) => u && u());
    unsubRef.current = [];

    const allTables = Array.from({ length: count }, (_, i) => String(i + 1));

    const chunks: string[][] = [];
    for (let i = 0; i < allTables.length; i += IN_FILTER_MAX) {
      chunks.push(allTables.slice(i, i + IN_FILTER_MAX));
    }

    const nextState: Record<string, OrderDoc | undefined> = {};
    allTables.forEach((t) => (nextState[t] = undefined));
    setActiveByTable(nextState);

    OPEN_STATUSES.forEach((st) => {
      chunks.forEach((tableChunk) => {
        const qRef = query(
          tCol("orders", tenantId),
          where("orderInfo.type", "==", "dine-in"),
          where("orderInfo.table", "in", tableChunk),
          where("status", "==", st),
          orderBy("createdAt", "desc"),
          limit(200)
        );

        const unsub = onSnapshot(qRef, (snap) => {
          const draft: Record<string, OrderDoc | undefined> = {};
          for (const d of snap.docs) {
            const data = d.data() as any;
            const tbl = String(data?.orderInfo?.table ?? "");
            if (!tbl) continue;

            const incoming: OrderDoc = { id: d.id, ...data } as OrderDoc;
            const ex = draft[tbl];
            if (!ex) {
              draft[tbl] = incoming;
            } else {
              const prevT = updatedOrCreatedAt(ex) as Date;
              const incT = updatedOrCreatedAt(incoming) as Date;
              if (incT >= prevT) draft[tbl] = incoming;
            }
          }

          setActiveByTable((prev) => {
            const merged = { ...prev };
            tableChunk.forEach((t) => {
              const incoming = draft[t];
              if (!incoming) return merged;
              const prevT = updatedOrCreatedAt(merged[t]) as Date;
              const incT = updatedOrCreatedAt(incoming) as Date;
              if (incT >= prevT) merged[t] = incoming;
            });
            return merged;
          });
        });

        unsubRef.current.push(unsub);
      });
    });
  }

  // ------------- UI Helpers -------------
  const tables = useMemo(() => Array.from({ length: numTables }, (_, i) => String(i + 1)), [numTables]);

  function tableOccupied(t: string) {
    return !!activeByTable[t];
  }

  function statusBadgeFor(t: string) {
    const st = activeByTable[t]?.status;
    if (!st) return null;
    const variant = STATUS_BADGE[st] ?? "secondary";
    const label = st.replaceAll("_", " ");
    return <span className={`badge text-bg-${variant} ms-2 text-capitalize`}>{label}</span>;
  }

  function openTablePanel(t: string) {
    setSelectedTable(t);
  }

  function closePanel() {
    setSelectedTable(null);
  }

  const selectedOrder: OrderDoc | undefined = selectedTable ? activeByTable[selectedTable] : undefined;

  // =================== Render ===================
  return (
    <ToolGate feature="waiter">
      <Protected>
        <OnlyWaiter>
          <main className="container-fluid py-3">
            {/* Top Controls */}
            <div className="container mb-3">
              <div className="d-flex flex-wrap align-items-end gap-3">
                <div>
                  <label className="form-label mb-1">{tt("admin.waiter.controls.tables", "Tables")}</label>
                  <input
                    type="number"
                    min={1}
                    max={200}
                    className="form-control"
                    value={numTables}
                    onChange={(e) => setNumTables(Math.min(200, Math.max(1, Number(e.target.value) || 1)))}
                    style={{ width: 140 }}
                  />
                </div>
                <button className="btn btn-primary" onClick={saveNumTables}>
                  {tt("admin.waiter.controls.save", "Save")}
                </button>
              </div>
            </div>

            {/* Floor (Desktop grid) */}
            <div
              className="container"
              style={{
                display: "grid",
                gap: "12px",
                gridTemplateColumns: "repeat(auto-fill, minmax(160px, 1fr))",
              }}
            >
              {tables.map((t) => {
                const occupied = tableOccupied(t);
                const bg = occupied ? "#e8f5e9" : "#f2f2f2";
                const border = occupied ? "1px solid #2e7d32" : "1px solid #bdbdbd";
                const text = occupied ? "#1b5e20" : "#616161";
                const order = activeByTable[t];
                const total = computeGrandTotal(order);

                return (
                  <button
                    key={t}
                    className="card shadow-sm text-start"
                    style={{
                      background: bg,
                      border,
                      color: text,
                      borderRadius: 16,
                      cursor: "pointer",
                    }}
                    onClick={() => openTablePanel(t)}
                  >
                    <div className="card-body d-flex flex-column justify-content-between" style={{ minHeight: 140 }}>
                      <div className="d-flex align-items-center justify-content-between">
                        <div className="d-flex align-items-center">
                          <span
                            className="me-2"
                            style={{
                              display: "inline-block",
                              width: 12,
                              height: 12,
                              borderRadius: "50%",
                              background: occupied ? "#2e7d32" : "#9e9e9e",
                            }}
                          />
                          <span className="fw-bold" style={{ fontSize: 22 }}>
                            {tt("admin.waiter.floor.table", `Table ${t}`, { n: t })}
                          </span>
                        </div>
                        {statusBadgeFor(t)}
                      </div>

                      <div className="mt-3 d-flex align-items-center justify-content-between">
                        {occupied ? (
                          <>
                            <div>
                              <div className="small text-muted">{tt("admin.waiter.floor.openOrder", "Open order")}</div>
                              <div className="fw-semibold">
                                {fmtQ(total)}
                              </div>
                            </div>
                            <div />
                          </>
                        ) : (
                          <>
                            <div className="text-muted">{tt("admin.waiter.floor.emptyTable", "Empty table")}</div>
                            <Link
                              href={`${PICK_TARGET_BASE}${encodeURIComponent(t)}`}
                              className="btn btn-sm btn-primary"
                              onClick={(e) => e.stopPropagation()}
                            >
                              {tt("admin.waiter.floor.pick", "Pick")}
                            </Link>
                          </>
                        )}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Drawer / Panel */}
            <div
              className={`offcanvas offcanvas-end ${selectedTable ? "show" : ""}`}
              style={{
                visibility: selectedTable ? "visible" : "hidden",
                transition: "visibility 0.2s",
                width: "min(720px, 100vw)",
              }}
              tabIndex={-1}
              aria-labelledby="tableDetailTitle"
            >
              <div className="offcanvas-header">
                <h5 id="tableDetailTitle" className="offcanvas-title">
                  {selectedTable
                    ? tt("admin.waiter.drawer.title", `Table ${selectedTable}`, { n: selectedTable })
                    : tt("admin.waiter.floor.tableShort", "Table")}
                </h5>
              </div>
              <div className="offcanvas-body">
                {!selectedTable ? null : !selectedOrder ? (
                  <div className="d-flex align-items-center justify-content-between">
                    <div className="text-muted">{tt("admin.waiter.drawer.empty", "Empty table. No open order.")}</div>
                    <Link
                      href={`${PICK_TARGET_BASE}${encodeURIComponent(selectedTable)}`}
                      className="btn btn-primary btn-sm"
                    >
                      {tt("admin.waiter.drawer.pick", "Pick")}
                    </Link>
                  </div>
                ) : (
                  <OrderDetailCard order={selectedOrder} onClose={closePanel} />
                )}
              </div>
            </div>

            {/* Backdrop for offcanvas */}
            {selectedTable && (
              <div
                className="offcanvas-backdrop fade show"
                onClick={closePanel}
                style={{ cursor: "pointer" }}
              />
            )}
          </main>
        </OnlyWaiter>
      </Protected>
    </ToolGate>
  );
}

// =================== Detail Panel ===================
function OrderDetailCard({ order, onClose }: { order: OrderDoc; onClose: () => void }) {
  const fmtQ = useFmtQ();

  // 🔤 idioma local
  const { settings } = useTenantSettings();
  const lang = React.useMemo(() => {
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

  const createdAt = tsToDate(order.createdAt);
  const invoiceDate = tsToDate(order.invoiceDate);

  const subtotal = getFreshSubtotal(order);
  const includeTaxInPrice = detectPricesIncludeTax(order);
  const tax = includeTaxInPrice ? 0 : (pickAmount(order, "tax") ?? 0);
  const tip = pickAmount(order, "tip");
  const discount = pickAmount(order, "discount");
  const total = computeGrandTotal(order);

  return (
    <div className="card border-0">
      <div className="card-body">
        <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
          <div>
            <div className="fw-bold h5 mb-0">
              {tt("admin.waiter.detail.order", `Order #${order.id.slice(-6)}`, { id: order.id.slice(-6) })}
            </div>
            <div className="text-muted small">
              {createdAt ? createdAt.toLocaleString() : ""}
            </div>
          </div>
          <div className="text-end">
            <div className="small text-muted">{tt("admin.waiter.detail.invoice", "Invoice")}</div>
            <div className="fw-semibold">{order.invoiceNumber || tt("admin.waiter.detail.noInvoice", "-")}</div>
            <div className="text-muted small">
              {invoiceDate ? invoiceDate.toLocaleString() : tt("admin.waiter.detail.noInvoice", "-")}
            </div>
          </div>
        </div>

        {/* Status */}
        {order.status && (
          <div className="mb-3">
            <span className={`badge text-bg-${STATUS_BADGE[order.status] ?? "secondary"} text-capitalize`}>
              {String(order.status).replaceAll("_", " ")}
            </span>
          </div>
        )}

        {/* Items */}
        <div className="mb-3">
          <h6 className="fw-bold">{tt("admin.waiter.detail.items", "Items")}</h6>
          <div className="d-flex flex-column gap-2">
            {(order.items ?? []).map((ln, idx) => (
              <div key={`${ln.menuItemId}-${idx}`} className="border rounded p-2">
                <div className="d-flex justify-content-between">
                  <div>
                    <div className="fw-semibold">
                      {ln.menuItemName || "Item"}{" "}
                      <span className="text-muted">× {ln.quantity}</span>
                    </div>
                    <div className="text-muted small">
                      {tt("admin.waiter.detail.item.base", "Base")}: {fmtQ(ln.basePrice)}{" "}
                      {typeof ln.lineTotal === "number" && (
                        <> • {tt("admin.waiter.detail.item.line", "Line")}: {fmtQ(ln.lineTotal)}</>
                      )}
                    </div>
                  </div>
                  <div className="fw-semibold">
                    {fmtQ(typeof ln.lineTotal === "number" ? ln.lineTotal : sumLine(ln))}
                  </div>
                </div>

                {(ln.addons?.length ?? 0) > 0 && (
                  <div className="mt-2 ps-2">
                    <div className="small fw-semibold">{tt("admin.waiter.detail.addons", "Add-ons")}</div>
                    <ul className="small mb-0">
                      {ln.addons!.map((a, i) => (
                        <li key={`a-${i}`}>
                          {a.name} {typeof a.price === "number" ? `(${fmtQ(a.price)})` : ""}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {(ln.optionGroups?.length ?? 0) > 0 && (
                  <div className="mt-2 ps-2">
                    <div className="small fw-semibold">{tt("admin.waiter.detail.options", "Options")}</div>
                    {(ln.optionGroups ?? []).map((g, gi) => (
                      <div key={`g-${gi}`} className="small">
                        <div className="text-muted">{g.groupName}</div>
                        <ul className="mb-1">
                          {(g.items ?? []).map((it, ii) => (
                            <li key={`gi-${gi}-it-${ii}`}>
                              {it.name}
                              {typeof it.priceDelta === "number" && it.priceDelta !== 0
                                ? ` (+${fmtQ(it.priceDelta)})`
                                : ""}
                            </li>
                          ))}
                        </ul>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Notes */}
        {order.orderInfo?.notes && (
          <div className="mb-3">
            <div className="small text-muted">{tt("admin.waiter.detail.notes", "Notes")}</div>
            <div>{order.orderInfo.notes}</div>
          </div>
        )}

        {/* Totals */}
        <div className="mb-3">
          <h6 className="fw-bold">{tt("admin.waiter.detail.totals", "Totals")}</h6>
          <div className="d-flex flex-column gap-1 small">
            <div className="d-flex justify-content-between">
              <span>{tt("admin.waiter.detail.subtotal", "Subtotal")}</span>
              <span>{fmtQ(subtotal)}</span>
            </div>

            {/* 👇 Mostrar impuesto solo si los precios NO incluyen impuesto */}
            {!includeTaxInPrice && (
              <div className="d-flex justify-content-between">
                <span>{tt("admin.waiter.detail.tax", "Tax")}</span>
                <span>{fmtQ(tax)}</span>
              </div>
            )}

            <div className="d-flex justify-content-between">
              <span>{tt("admin.waiter.detail.tip", "Tip")}</span>
              <span>{fmtQ(tip)}</span>
            </div>
            <div className="d-flex justify-content-between">
              <span>{tt("admin.waiter.detail.discount", "Discount")}</span>
              <span>{fmtQ(discount)}</span>
            </div>
            <div className="d-flex justify-content-between fw-semibold border-top pt-2">
              <span>{tt("admin.waiter.detail.total", "Total")}</span>
              <span>{fmtQ(total)}</span>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="d-flex gap-2">
          <a className="btn btn-outline-primary" href="/admin/edit-orders">
            {tt("admin.waiter.detail.actions.edit", "Edit order")}
          </a>
          <button className="btn btn-secondary" onClick={onClose}>
            {tt("admin.waiter.detail.actions.close", "Close")}
          </button>
        </div>
      </div>
    </div>
  );
}
