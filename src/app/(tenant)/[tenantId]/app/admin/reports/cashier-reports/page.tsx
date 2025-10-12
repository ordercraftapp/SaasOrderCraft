// src/app/(tenant)/[tenant]/app/admin/cashier-reports/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import Protected from "@/app/(tenant)/[tenantId]/components/Protected";
import AdminOnly from "@/app/(tenant)/[tenantId]/components/AdminOnly";
import ToolGate from "@/components/ToolGate";
import "@/lib/firebase/client";
import {
  getFirestore,
  query,
  where,
  orderBy,
  getDocs,
  Timestamp,
  DocumentData,
  updateDoc,
  serverTimestamp,
} from "firebase/firestore";
import { useFmtQ /* , fmtCents */ } from "@/lib/settings/money";

// 🔤 i18n
import { t as translate } from "@/lib/i18n/t";
import { useTenantSettings } from "@/lib/settings/hooks";

/** ✅ Helpers tenant-aware (Web SDK) */
import { tCol, tDoc } from "@/lib/db";
import { useTenantId } from "@/lib/tenant/context";

/** ========= Types ========= */
type OrderDoc = {
  id: string;
  createdAt?: Timestamp | { seconds: number } | Date | null;
  totals?: { grandTotalWithTax?: number } | null;
  totalsCents?: { grandTotalWithTaxCents?: number } | null;
  payment?: {
    provider?: string | null;
    status?: string | null;
    amount?: number | null;
    currency?: string | null;
    createdAt?: Timestamp | { seconds: number } | Date | null;
    updatedAt?: Timestamp | { seconds: number } | Date | null;
  } | null;
  orderTotal?: number | null;
};

type CashboxSession = {
  id: string;
  openedAt?: Timestamp | { seconds: number } | Date | null;
  closedAt?: Timestamp | { seconds: number } | Date | null;
  openingAmountCents?: number | null;
  closingAmountCents?: number | null;
  declaredClosingAmountCents?: number | null;
  cashierName?: string | null;
  notes?: string | null;
  sessionDate?: string | null; // 'YYYY-MM-DD'
};

type PieRow = { label: string; value: number; color?: string };

/** ========= Utils ========= */
function toDate(v: any): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (v?.seconds != null) return new Date(v.seconds * 1000);
  const d = new Date(v);
  return isNaN(d as any) ? null : d;
}

function getOrderRevenue(o: OrderDoc): number {
  const cents = o.totalsCents?.grandTotalWithTaxCents;
  if (Number.isFinite(cents)) return (cents as number) / 100;
  const withTax = o.totals?.grandTotalWithTax;
  if (Number.isFinite(withTax)) return withTax as number;
  const pay = o.payment?.amount;
  if (Number.isFinite(pay)) return pay as number;
  const legacy = o.orderTotal;
  if (Number.isFinite(legacy ?? NaN)) return Number(legacy);
  return 0;
}

/** ✅ Considerar 'closed' como pagado (flujo de caja en efectivo) */
function isPaidStatus(s?: string | null): boolean {
  const ok = new Set(["paid", "captured", "completed", "succeeded", "closed"]);
  return s ? ok.has(String(s).toLowerCase()) : false;
}
function isUnpaidOrRejected(s?: string | null): boolean {
  const bad = new Set(["pending", "failed", "rejected", "canceled", "void", "refunded"]);
  return s ? bad.has(String(s).toLowerCase()) : false;
}

/** ========= Simple Pie (SVG) ========= */
function hsl(i: number, total: number) {
  const hue = Math.round((360 * i) / Math.max(1, total));
  return `hsl(${hue} 70% 55%)`;
}
function polarToCartesian(cx: number, cy: number, r: number, angle: number) {
  const rad = ((angle - 90) * Math.PI) / 180.0;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}
function arcPath(cx: number, cy: number, r: number, startAngle: number, endAngle: number) {
  const start = polarToCartesian(cx, cy, r, endAngle);
  const end = polarToCartesian(cx, cy, r, startAngle);
  const largeArcFlag = endAngle - startAngle <= 180 ? "0" : "1";
  return `M ${cx} ${cy} L ${start.x} ${start.y} A ${r} ${r} 0 ${largeArcFlag} 0 ${end.x} ${end.y} Z`;
}
function PieChart({ rows, size = 220, title }: { rows: PieRow[]; size?: number; title: string }) {
  // 🔤 i18n dentro del componente
  const { settings } = useTenantSettings();
  const lang = React.useMemo(() => {
    try {
      if (typeof window !== "undefined") {
        const sp = new URLSearchParams(window.location.search);
        const q = sp.get("lang");
        if (q) {
          const v = q.toLowerCase();
          try { localStorage.setItem("tenant.language", v); } catch {}
          return v;
        }
      }
    } catch {}
    try {
      if (typeof window !== "undefined") {
        const ls = localStorage.getItem("tenant.language");
        if (ls) return ls;
      }
    } catch {}
    return (settings as any)?.language || "en";
  }, [settings]);
  const tt = (key: string, fallback: string, vars?: Record<string, unknown>) => {
    const s = translate(lang, key, vars);
    return s === key ? fallback : s;
  };

  const total = rows.reduce((s, r) => s + (Number(r.value) || 0), 0);
  const cx = size / 2, cy = size / 2, r = size / 2 - 4;
  let angle = 0;
  const slices = rows.map((row, i) => {
    const pct = total > 0 ? row.value / total : 0;
    const start = angle;
    const end = angle + pct * 360;
    angle = end;
    return { key: row.label + i, d: arcPath(cx, cy, r, start, end), fill: row.color || hsl(i, rows.length + 2), pct, label: row.label, value: row.value };
  });

  return (
    <div className="card border-0 shadow-sm h-100">
      <div className="card-header fw-semibold d-flex justify-content-between align-items-center">
        <span>{title}</span>
        <span className="small text-muted">
          {total === 0 ? tt("admin.cashrep.nodata", "No data") : tt("admin.cashrep.segments", "{n} segments", { n: rows.length })}
        </span>
      </div>
      <div className="card-body">
        {total === 0 ? (
          <div className="text-muted small">{tt("admin.cashrep.nodata", "No data")}</div>
        ) : (
          <div className="d-flex flex-column flex-md-row align-items-center gap-3">
            <div style={{ width: "100%", maxWidth: size }}>
              <svg viewBox={`0 0 ${size} ${size}`} style={{ width: "100%", height: "auto" }}>
                {slices.map((s) => (<path key={s.key} d={s.d} fill={s.fill} stroke="white" strokeWidth="1" />))}
              </svg>
            </div>
            <div className="flex-grow-1 w-100">
              <div className="d-flex flex-column gap-2">
                {slices.map((s) => (
                  <div key={s.key} className="d-flex align-items-center justify-content-between border rounded px-2 py-1">
                    <div className="d-flex align-items-center gap-2">
                      <span className="rounded-circle" style={{ display: "inline-block", width: 12, height: 12, background: s.fill }} />
                      <span className="small">{s.label}</span>
                    </div>
                    <div className="small text-muted">{s.value} · {(s.pct * 100).toFixed(1)}%</div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

/** ========= Excel (SpreadsheetML 2003) ========= */
// (sin cambios en export a Excel)
type Sheet = { name: string; headers: string[]; rows: (string | number)[][] };
function xmlEscape(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}
function buildExcelXml(sheets: Sheet[]) {
  const ns =
    'xmlns="urn:schemas-microsoft-com:office:spreadsheet" ' +
    'xmlns:o="urn:schemas-microsoft-com:office:office" ' +
    'xmlns:x="urn:schemas-microsoft-com:office:excel" ' +
    'xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet" ' +
    'xmlns:html="http://www.w3.org/TR/REC-html40"';
  const header = `<?xml version="1.0"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook ${ns}>
<Styles>
  <Style ss:ID="sHeader"><Font ss:Bold="1"/><Interior ss:Color="#F2F2F2" ss:Pattern="Solid"/></Style>
  <Style ss:ID="sMoney"><NumberFormat ss:Format="Currency"/></Style>
  <Style ss:ID="sNumber"><NumberFormat ss:Format="General Number"/></Style>
</Styles>`;
  const sheetsXml = sheets.map((sheet) => {
    const cols = sheet.headers.map(() => `<Column ss:AutoFitWidth="1" ss:Width="160"/>`).join("");
    const headRow =
      `<Row>` +
      sheet.headers.map((h) => `<Cell ss:StyleID="sHeader"><Data ss:Type="String">${xmlEscape(h)}</Data></Cell>`).join("") +
      `</Row>`;
    const bodyRows = sheet.rows
      .map((r) => {
        const cells = r
          .map((v) =>
            typeof v === "number" && Number.isFinite(v)
              ? `<Cell ss:StyleID="${Number.isInteger(v) ? "sNumber" : "sMoney"}"><Data ss:Type="Number">${v}</Data></Cell>`
              : `<Cell><Data ss:Type="String">${xmlEscape(String(v))}</Data></Cell>`
          )
          .join("");
        return `<Row>${cells}</Row>`;
      })
      .join("\n");
    return `<Worksheet ss:Name="${xmlEscape(sheet.name)}"><Table>${cols}${headRow}${bodyRows}</Table></Worksheet>`;
  }).join("\n");
  return header + sheetsXml + `</Workbook>`;
}
function downloadExcelXml(filename: string, xml: string) {
  const blob = new Blob([xml], { type: "application/vnd.ms-excel" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".xls") ? filename : `${filename}.xls`;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { document.body.removeChild(a); URL.revokeObjectURL(url); }, 0);
}

/** ========= Page ========= */
export default function AdminCashierReportsPage() {
  const tenantId = useTenantId() as string;
  const db = getFirestore();
  const fmtQ = useFmtQ();

  // 🔤 i18n init (URL ?lang → localStorage → settings)
  const { settings } = useTenantSettings();
  const lang = React.useMemo(() => {
    try {
      if (typeof window !== "undefined") {
        const sp = new URLSearchParams(window.location.search);
        const q = sp.get("lang");
        if (q) {
          const v = q.toLowerCase();
          try { localStorage.setItem("tenant.language", v); } catch {}
          return v;
        }
      }
    } catch {}
    try {
      if (typeof window !== "undefined") {
        const ls = localStorage.getItem("tenant.language");
        if (ls) return ls;
      }
    } catch {}
    return (settings as any)?.language || "en";
  }, [settings]);
  const tt = (key: string, fallback: string, vars?: Record<string, unknown>) => {
    const s = translate(lang, key, vars);
    return s === key ? fallback : s;
  };

  // Filters
  const [preset, setPreset] = useState<"today" | "7d" | "30d" | "thisMonth" | "custom">("30d");
  const [fromStr, setFromStr] = useState<string>("");
  const [toStr, setToStr] = useState<string>("");

  useEffect(() => {
    const today = new Date();
    const to = new Date(today); to.setHours(23,59,59,999);
    const from = new Date(); from.setDate(from.getDate()-29); from.setHours(0,0,0,0);
    setFromStr(from.toISOString().slice(0,10));
    setToStr(to.toISOString().slice(0,10));
  }, []);
  useEffect(() => {
    if (preset === "custom") return;
    const now = new Date();
    if (preset === "today") {
      const f = new Date(now); f.setHours(0,0,0,0);
      const t = new Date(now); t.setHours(23,59,59,999);
      setFromStr(f.toISOString().slice(0,10)); setToStr(t.toISOString().slice(0,10)); return;
    }
    if (preset === "7d") {
      const f = new Date(); f.setDate(f.getDate()-6); f.setHours(0,0,0,0);
      const t = new Date(now); t.setHours(23,59,59,999);
      setFromStr(f.toISOString().slice(0,10)); setToStr(t.toISOString().slice(0,10)); return;
    }
    if (preset === "30d") {
      const f = new Date(); f.setDate(f.getDate()-29); f.setHours(0,0,0,0);
      const t = new Date(now); t.setHours(23,59,59,999);
      setFromStr(f.toISOString().slice(0,10)); setToStr(t.toISOString().slice(0,10)); return;
    }
    if (preset === "thisMonth") {
      const f = new Date(now.getFullYear(), now.getMonth(), 1);
      const t = new Date(now.getFullYear(), now.getMonth()+1, 0);
      setFromStr(f.toISOString().slice(0,10)); setToStr(t.toISOString().slice(0,10)); return;
    }
  }, [preset]);

  // Data
  const [loading, setLoading] = useState(false);
  const [orders, setOrders] = useState<OrderDoc[]>([]);
  const [sessions, setSessions] = useState<CashboxSession[]>([]);
  const [error, setError] = useState<string | null>(null);

  // ⬇️ NUEVO: estado para acción de cierre de pago en efectivo
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  async function load() {
    if (!tenantId) return;
    setError(null); setLoading(true);
    try {
      const from = new Date(fromStr + "T00:00:00");
      const to = new Date(toStr + "T23:59:59.999");

      // Orders in range (scoped)
      const qRef = query(
        tCol("orders", tenantId),
        where("createdAt", ">=", Timestamp.fromDate(from)),
        where("createdAt", "<=", Timestamp.fromDate(to)),
        orderBy("createdAt", "asc"),
      );
      const snap = await getDocs(qRef);
      const arr: OrderDoc[] = snap.docs.map((d) => {
        const raw = d.data() as DocumentData;
        return {
          id: d.id,
          createdAt: raw.createdAt ?? null,
          totals: raw.totals ?? null,
          totalsCents: raw.totalsCents ?? null,
          payment: raw.payment ?? null,
          orderTotal: Number.isFinite(raw.orderTotal) ? Number(raw.orderTotal) : null,
        };
      });
      setOrders(arr);

      // Optional: cashbox sessions in range (scoped)
      try {
        const qs = query(
          tCol("cashboxSessions", tenantId),
          where("openedAt", ">=", Timestamp.fromDate(from)),
          where("openedAt", "<=", Timestamp.fromDate(to)),
          orderBy("openedAt", "asc"),
        );
        const snapS = await getDocs(qs);
        const sess: CashboxSession[] = snapS.docs.map((d) => {
          const r = d.data() as any;
          return {
            id: d.id,
            openedAt: r.openedAt ?? null,
            closedAt: r.closedAt ?? null,
            openingAmountCents: Number.isFinite(r.openingAmountCents) ? Number(r.openingAmountCents) : null,
            closingAmountCents: Number.isFinite(r.closingAmountCents) ? Number(r.closingAmountCents) : null,
            declaredClosingAmountCents: Number.isFinite(r.declaredClosingAmountCents) ? Number(r.declaredClosingAmountCents) : null,
            cashierName: r.cashierName ?? null,
            notes: r.notes ?? null,
            sessionDate: r.sessionDate ?? null,
          };
        });
        setSessions(sess);
      } catch {
        setSessions([]); // collection missing or no perms: ignore
      }
    } catch (e: any) {
      setError(e?.message || tt("admin.cashrep.err.load", "Failed to load data."));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { if (fromStr && toStr) load(); /* eslint-disable-next-line */ }, [fromStr, toStr, tenantId]);

  /** ========= Aggregations ========= */
  const currency = useMemo(() => orders[0]?.payment?.currency || "USD", [orders]);

  const byMethod = useMemo(() => {
    const m = new Map<string, { count: number; revenue: number; paidCount: number }>();
    for (const o of orders) {
      const method = (o.payment?.provider || "unknown").toString();
      const paid = isPaidStatus(o.payment?.status);
      const cur = m.get(method) || { count: 0, revenue: 0, paidCount: 0 };
      cur.count += 1;
      cur.revenue += getOrderRevenue(o);
      if (paid) cur.paidCount += 1;
      m.set(method, cur);
    }
    return Array.from(m.entries()).map(([label, v]) => ({ label, ...v }))
      .sort((a,b) => b.count - a.count);
  }, [orders]);

  const pieByMethodCount: PieRow[] = useMemo(() => byMethod.map(x => ({ label: x.label, value: x.count })), [byMethod]);
  const pieByMethodRevenue: PieRow[] = useMemo(() => byMethod.map(x => ({ label: x.label, value: Number(x.revenue.toFixed(2)) })), [byMethod]);

  const unpaidOrRejected = useMemo(() => orders.filter(o => isUnpaidOrRejected(o.payment?.status)), [orders]);

  const cashOrders = useMemo(() =>
    orders.filter(o =>
      String(o.payment?.provider || "").toLowerCase() === "cash" && isPaidStatus(o.payment?.status)
    ), [orders]
  );

  const totalOrders = orders.length;
  const totalRevenue = useMemo(() => orders.reduce((s, o) => s + getOrderRevenue(o), 0), [orders]);
  const totalCashRevenue = useMemo(() => cashOrders.reduce((s, o) => s + getOrderRevenue(o), 0), [cashOrders]);

  const sessionsAugmented = useMemo(() => {
    if (!sessions.length) return [];
    const cashByDay = new Map<string, number>();
    for (const o of cashOrders) {
      const d = toDate(o.payment?.createdAt || o.createdAt) || toDate(o.createdAt);
      const key = d ? d.toISOString().slice(0,10) : "unknown";
      cashByDay.set(key, (cashByDay.get(key) || 0) + getOrderRevenue(o));
    }
    return sessions.map((s) => {
      const opened = toDate(s.openedAt);
      const dayKey = s.sessionDate || (opened ? opened.toISOString().slice(0,10) : "unknown");
      const expectedCashMov = cashByDay.get(dayKey) || 0;
      const opening = (s.openingAmountCents || 0) / 100;
      const expectedClose = opening + expectedCashMov;
      const declaredClose = (s.declaredClosingAmountCents ?? s.closingAmountCents ?? null);
      const declared = declaredClose != null ? (declaredClose as number) / 100 : null;
      const diff = declared != null ? declared - expectedClose : null;
      return { ...s, dayKey, expectedCashMov, opening, expectedClose, declared, diff };
    }).sort((a,b) => (toDate(a.openedAt)?.getTime() || 0) - (toDate(b.openedAt)?.getTime() || 0));
  }, [sessions, cashOrders]);

  /** ========= Acción: Marcar pago CASH como closed ========= */
  async function markCashPaymentClosed(orderId: string) {
    try {
      setUpdatingId(orderId);
      await updateDoc(tDoc("orders", tenantId, orderId), {
        "payment.status": "closed",
        "payment.provider": "cash",
        "payment.updatedAt": serverTimestamp(),
      });
      await load();
    } catch (e: any) {
      alert(e?.message || tt("admin.cashrep.err.update", "Could not update payment status."));
    } finally {
      setUpdatingId(null);
    }
  }

  /** ========= Export ========= */
  function onExportExcel() {
    // ⚠️ SIN CAMBIOS EN EXPORT/HEADERS
    const summary: Sheet = {
      name: "Summary",
      headers: ["Metric", "Value"],
      rows: [
        ["Orders", totalOrders],
        [`Revenue (${currency})`, Number(totalRevenue.toFixed(2))],
        [`Cash revenue (${currency})`, Number(totalCashRevenue.toFixed(2))],
        ["Unpaid/Rejected orders", unpaidOrRejected.length],
      ],
    };
    const byMethodSheet: Sheet = {
      name: "PaymentsByMethod",
      headers: ["Method", "Orders", "Paid Orders", `Revenue (${currency})`],
      rows: byMethod.map(x => [x.label, x.count, x.paidCount, Number(x.revenue.toFixed(2))]),
    };
    const unpaidSheet: Sheet = {
      name: "UnpaidOrRejected",
      headers: ["OrderId", "CreatedAt (UTC)", "Method", "Status", `Amount (${currency})`],
      rows: unpaidOrRejected.map(o => [
        o.id,
        toDate(o.createdAt)?.toISOString().replace("T"," ").slice(0,19) || "",
        o.payment?.provider || "",
        o.payment?.status || "",
        Number(getOrderRevenue(o).toFixed(2)),
      ]),
    };
    const cashSheet: Sheet = {
      name: "CashPayments",
      headers: ["OrderId", "PaidAt (UTC)", `Amount (${currency})`],
      rows: cashOrders.map(o => [
        o.id,
        (toDate(o.payment?.createdAt || o.createdAt)?.toISOString().replace("T"," ").slice(0,19)) || "",
        Number(getOrderRevenue(o).toFixed(2)),
      ]),
    };
    const ordersSheet: Sheet = {
      name: "Orders",
      headers: ["OrderId", "CreatedAt (UTC)", "Method", "Status", `Revenue (${currency})`],
      rows: orders.map(o => [
        o.id,
        toDate(o.createdAt)?.toISOString().replace("T"," ").slice(0,19) || "",
        o.payment?.provider || "",
        o.payment?.status || "",
        Number(getOrderRevenue(o).toFixed(2)),
      ]),
    };

    const sheets: Sheet[] = [summary, byMethodSheet, unpaidSheet, cashSheet, ordersSheet];

    if (sessionsAugmented.length > 0) {
      sheets.splice(1, 0, {
        name: "CashboxSessions",
        headers: ["Date", "Cashier", `Opening (${currency})`, `Expected close (${currency})`, `Declared close (${currency})`, `Diff (${currency})`],
        rows: sessionsAugmented.map(s => [
          s.dayKey || "",
          s.cashierName || "",
          Number((s.opening ?? 0).toFixed(2)),
          Number((s.expectedClose ?? 0).toFixed(2)),
          s.declared != null ? Number(s.declared.toFixed(2)) : "",
          s.diff != null ? Number(s.diff.toFixed(2)) : "",
        ]),
      });
    }

    const xml = buildExcelXml(sheets);
    downloadExcelXml(`cashier_report_${fromStr}_to_${toStr}.xls`, xml);
  }

  return (
    <Protected>
      <AdminOnly>
        <ToolGate feature="cashierReports">
          <main className="container py-4">
            <h1 className="h4 mb-3">{tt("admin.cashrep.title", "Cashier & Payments")}</h1>

            {/* Filters */}
            <div className="card border-0 shadow-sm mb-3">
              <div className="card-body">
                <div className="row g-3">
                  <div className="col-12 col-md-3">
                    <label className="form-label fw-semibold">{tt("admin.cashrep.range", "Range")}</label>
                    <select className="form-select" value={preset} onChange={(e) => setPreset(e.target.value as any)}>
                      <option value="today">{tt("admin.cashrep.preset.today", "Today")}</option>
                      <option value="7d">{tt("admin.cashrep.preset.7d", "Last 7 days")}</option>
                      <option value="30d">{tt("admin.cashrep.preset.30d", "Last 30 days")}</option>
                      <option value="thisMonth">{tt("admin.cashrep.preset.thisMonth", "This month")}</option>
                      <option value="custom">{tt("admin.cashrep.preset.custom", "Custom")}</option>
                    </select>
                  </div>
                  <div className="col-6 col-md-3">
                    <label className="form-label fw-semibold">{tt("admin.cashrep.from", "From")}</label>
                    <input type="date" className="form-control" value={fromStr} onChange={(e) => { setFromStr(e.target.value); setPreset("custom"); }} />
                  </div>
                  <div className="col-6 col-md-3">
                    <label className="form-label fw-semibold">{tt("admin.cashrep.to", "To")}</label>
                    <input type="date" className="form-control" value={toStr} onChange={(e) => { setToStr(e.target.value); setPreset("custom"); }} />
                  </div>
                  <div className="col-12 col-md-3 d-flex align-items-end">
                    <div className="d-flex gap-2 w-100">
                      <button className="btn btn-primary flex-fill" onClick={load} disabled={loading}>
                        {loading ? tt("common.loadingDots", "Loading…") : tt("common.refresh", "Refresh")}
                      </button>
                      <button className="btn btn-outline-success" onClick={onExportExcel} disabled={loading || orders.length === 0}>
                        {tt("admin.cashrep.export", "Export to Excel")}
                      </button>
                    </div>
                  </div>
                </div>
                {error && <div className="text-danger small mt-2">{error}</div>}
              </div>
            </div>

            {/* KPIs */}
            <div className="row g-3 mb-3">
              <div className="col-6 col-md-3">
                <div className="card border-0 shadow-sm"><div className="card-body">
                  <div className="text-muted small">{tt("admin.cashrep.kpi.orders", "Orders")}</div>
                  <div className="h4 mb-0">{totalOrders}</div>
                </div></div>
              </div>
              <div className="col-6 col-md-3">
                <div className="card border-0 shadow-sm"><div className="card-body">
                  <div className="text-muted small">{tt("admin.cashrep.kpi.revenue", "Revenue")}</div>
                  <div className="h4 mb-0">{fmtQ(totalRevenue)}</div>
                </div></div>
              </div>
              <div className="col-6 col-md-3">
                <div className="card border-0 shadow-sm"><div className="card-body">
                  <div className="text-muted small">{tt("admin.cashrep.kpi.cashRevenue", "Cash revenue")}</div>
                  <div className="h5 mb-0">{fmtQ(totalCashRevenue)}</div>
                </div></div>
              </div>
              <div className="col-6 col-md-3">
                <div className="card border-0 shadow-sm"><div className="card-body">
                  <div className="text-muted small">{tt("admin.cashrep.kpi.unpaidRejected", "Unpaid/Rejected")}</div>
                  <div className="h4 mb-0">{unpaidOrRejected.length}</div>
                </div></div>
              </div>
            </div>

            {/* Tables */}
            <div className="row g-3">
              <div className="col-12 col-lg-6">
                <div className="card border-0 shadow-sm h-100">
                  <div className="card-header fw-semibold">{tt("admin.cashrep.table.methods.title", "Payment methods")}</div>
                  <div className="card-body p-0">
                    <div className="table-responsive">
                      <table className="table mb-0">
                        <thead>
                          <tr>
                            <th>{tt("admin.cashrep.table.methods.method", "Method")}</th>
                            <th className="text-end">{tt("admin.cashrep.table.methods.orders", "Orders")}</th>
                            <th className="text-end">{tt("admin.cashrep.table.methods.paid", "Paid Orders")}</th>
                            <th className="text-end">{tt("admin.cashrep.table.methods.revenue", "Revenue")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {byMethod.length === 0 && <tr><td colSpan={4} className="text-center text-muted">{tt("admin.cashrep.nodata", "No data")}</td></tr>}
                          {byMethod.map((m) => (
                            <tr key={m.label}>
                              <td className="text-nowrap">{m.label}</td>
                              <td className="text-end">{m.count}</td>
                              <td className="text-end">{m.paidCount}</td>
                              <td className="text-end">{fmtQ(m.revenue)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </div>

              <div className="col-12 col-lg-6">
                <div className="card border-0 shadow-sm h-100">
                  <div className="card-header fw-semibold">{tt("admin.cashrep.table.unpaid.title", "Unpaid / Rejected Orders")}</div>
                  <div className="card-body p-0">
                    <div className="table-responsive">
                      <table className="table mb-0">
                        <thead>
                          <tr>
                            <th>{tt("admin.cashrep.table.unpaid.order", "Order")}</th>
                            <th>{tt("admin.cashrep.table.unpaid.method", "Method")}</th>
                            <th>{tt("admin.cashrep.table.unpaid.status", "Status")}</th>
                            <th className="text-end">{tt("admin.cashrep.table.unpaid.amount", "Amount")}</th>
                            <th className="text-end">{tt("admin.cashrep.table.unpaid.action", "Action")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {unpaidOrRejected.length === 0 && <tr><td colSpan={5} className="text-center text-muted">{tt("admin.cashrep.nodata", "No data")}</td></tr>}
                          {unpaidOrRejected.map((o) => {
                            const isCash = String(o.payment?.provider || "").toLowerCase() === "cash";
                            const canCloseCash = isCash && !isPaidStatus(o.payment?.status);
                            return (
                              <tr key={o.id}>
                                <td className="text-nowrap">{o.id}</td>
                                <td>{o.payment?.provider || "—"}</td>
                                <td>{o.payment?.status || "—"}</td>
                                <td className="text-end">{fmtQ(getOrderRevenue(o))}</td>
                                <td className="text-end">
                                  {canCloseCash ? (
                                    <button
                                      className="btn btn-sm btn-outline-success"
                                      onClick={() => markCashPaymentClosed(o.id)}
                                      disabled={updatingId === o.id}
                                    >
                                      {updatingId === o.id
                                        ? tt("admin.cashrep.updating", "Updating…")
                                        : tt("admin.cashrep.markClosedCash", "Mark closed (cash)")}
                                    </button>
                                  ) : (
                                    <span className="text-muted small">—</span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div className="card-footer small text-muted">
                    {tt("admin.cashrep.tip", "Tip: use “Mark closed (cash)” to close cash payments from here.")}
                  </div>
                </div>
              </div>
            </div>

            {/* Pies */}
            <div className="row g-3 mt-3">
              <div className="col-12 col-lg-6">
                <PieChart rows={pieByMethodCount} title={tt("admin.cashrep.pie.count", "Payments by Method (count)")} />
              </div>
              <div className="col-12 col-lg-6">
                <PieChart rows={pieByMethodRevenue} title={tt("admin.cashrep.pie.revenue", "Payments by Method (revenue)")} />
              </div>
            </div>

            <div className="text-muted small mt-3">
              {tt("admin.cashrep.notes", "Notes: cash revenue computed from paid/closed cash orders within range.")}
            </div>
          </main>
        </ToolGate>
      </AdminOnly>
    </Protected>
  );
}
