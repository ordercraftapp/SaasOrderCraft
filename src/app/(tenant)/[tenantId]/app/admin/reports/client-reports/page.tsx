// src/app/(tenant)/[tenant]/app/admin/client-reports/page.tsx
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
} from "firebase/firestore";

// 🔤 i18n
import { t as translate } from "@/lib/i18n/t";
import { useTenantSettings } from "@/lib/settings/hooks";

/** ✅ Helpers tenant-aware (Web SDK) */
import { tCol } from "@/lib/db";
import { useTenantId } from "@/lib/tenant/context";

/** ========= Types ========= */
type OrderDoc = {
  id: string;
  createdAt?: Timestamp | { seconds: number } | Date | null;
  orderInfo?: { type?: "dine-in" | "delivery" | "pickup" | string; orderSource?: string | null } | null;
  totals?: { grandTotalWithTax?: number } | null;
  totalsCents?: { grandTotalWithTaxCents?: number } | null;
  payment?: { amount?: number } | null;
  orderTotal?: number | null;

  userEmail?: string | null;
  userEmail_lower?: string | null;
  createdBy?: { uid?: string | null; email?: string | null } | null;
};

type CustomerAgg = {
  key: string;            // uid || userEmail_lower || userEmail || "guest:<id>"
  label: string;          // best-effort: email || uid || "Guest"
  orders: number;
  revenue: number;
  firstOrderAt: Date | null;
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
function money(n: number | undefined): string {
  const v = Number.isFinite(Number(n)) ? Number(n) : 0;
  try {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(v);
  } catch {
    return `$${v.toFixed(2)}`;
  }
}
function getOrderRevenueUSD(o: OrderDoc): number {
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
function getOrderType(o: OrderDoc): string {
  return (o.orderInfo?.type || "unknown") as string;
}
function getOrderChannel(o: OrderDoc): string | null {
  const src = (o.orderInfo as any)?.orderSource;
  if (typeof src === "string" && src.trim()) return src.trim();
  return null;
}
function customerKey(o: OrderDoc): { key: string; label: string } {
  const email =
    (o.userEmail_lower && String(o.userEmail_lower)) ||
    (o.userEmail && String(o.userEmail).toLowerCase()) ||
    (o.createdBy?.email && String(o.createdBy.email).toLowerCase());
  const uid = o.createdBy?.uid && String(o.createdBy.uid);
  if (email) return { key: `email:${email}`, label: email };
  if (uid) return { key: `uid:${uid}`, label: uid };
  return { key: `guest:${o.id}`, label: "Guest" };
}

/** ========= Simple Pie (SVG, sin dependencias) ========= */
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
function PieChart({
  rows,
  size = 220,
  title,
}: {
  rows: PieRow[];
  size?: number;
  title: string;
}) {
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
    return {
      key: row.label + i,
      d: arcPath(cx, cy, r, start, end),
      fill: row.color || hsl(i, rows.length + 2),
      pct,
      label: row.label,
      value: row.value,
    };
  });

  return (
    <div className="card border-0 shadow-sm h-100">
      <div className="card-header fw-semibold d-flex justify-content-between align-items-center">
        <span>{title}</span>
        <span className="small text-muted">
          {total === 0 ? tt("admin.clientrep.nodata", "No data") : tt("admin.clientrep.segments", "{n} segments", { n: rows.length })}
        </span>
      </div>
      <div className="card-body">
        {total === 0 ? (
          <div className="text-muted small">{tt("admin.clientrep.nodata", "No data")}</div>
        ) : (
          <div className="d-flex flex-column flex-md-row align-items-center gap-3">
            <div style={{ width: "100%", maxWidth: size }}>
              <svg viewBox={`0 0 ${size} ${size}`} style={{ width: "100%", height: "auto" }}>
                {slices.map((s) => (
                  <path key={s.key} d={s.d} fill={s.fill} stroke="white" strokeWidth="1" />
                ))}
              </svg>
            </div>
            <div className="flex-grow-1 w-100">
              <div className="d-flex flex-column gap-2">
                {slices.map((s) => (
                  <div
                    key={s.key}
                    className="d-flex align-items-center justify-content-between border rounded px-2 py-1"
                  >
                    <div className="d-flex align-items-center gap-2">
                      <span className="rounded-circle" style={{ display: "inline-block", width: 12, height: 12, background: s.fill }} />
                      <span className="small">{s.label}</span>
                    </div>
                    <div className="small text-muted">
                      {s.value} · {(s.pct * 100).toFixed(1)}%
                    </div>
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
export default function AdminClientReportsPage() {
  const tenantId = useTenantId() as string;
  const db = getFirestore();

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

  // Data state
  const [loading, setLoading] = useState(false);
  const [ordersInRange, setOrdersInRange] = useState<OrderDoc[]>([]);
  const [ordersUntilTo, setOrdersUntilTo] = useState<OrderDoc[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!tenantId) return;
    setError(null); setLoading(true);
    try {
      const from = new Date(fromStr + "T00:00:00");
      const to = new Date(toStr + "T23:59:59.999");

      // (A) Órdenes dentro del rango (scoped)
      const qRange = query(
        tCol("orders", tenantId),
        where("createdAt", ">=", Timestamp.fromDate(from)),
        where("createdAt", "<=", Timestamp.fromDate(to)),
        orderBy("createdAt", "asc"),
      );
      const snapRange = await getDocs(qRange);
      const arrRange: OrderDoc[] = snapRange.docs.map((d) => {
        const raw = d.data() as DocumentData;
        return {
          id: d.id,
          createdAt: raw.createdAt ?? null,
          orderInfo: raw.orderInfo ?? null,
          totals: raw.totals ?? null,
          totalsCents: raw.totalsCents ?? null,
          payment: raw.payment ?? null,
          orderTotal: Number.isFinite(raw.orderTotal) ? Number(raw.orderTotal) : null,
          userEmail: raw.userEmail ?? null,
          userEmail_lower: raw.userEmail_lower ?? null,
          createdBy: raw.createdBy ?? null,
        };
      });
      setOrdersInRange(arrRange);

      // (B) Órdenes hasta "to" (scoped)
      const qUntil = query(
        tCol("orders", tenantId),
        where("createdAt", "<=", Timestamp.fromDate(to)),
        orderBy("createdAt", "asc"),
      );
      const snapUntil = await getDocs(qUntil);
      const arrUntil: OrderDoc[] = snapUntil.docs.map((d) => {
        const raw = d.data() as DocumentData;
        return {
          id: d.id,
          createdAt: raw.createdAt ?? null,
          orderInfo: null,
          totals: raw.totals ?? null,
          totalsCents: raw.totalsCents ?? null,
          payment: raw.payment ?? null,
          orderTotal: Number.isFinite(raw.orderTotal) ? Number(raw.orderTotal) : null,
          userEmail: raw.userEmail ?? null,
          userEmail_lower: raw.userEmail_lower ?? null,
          createdBy: raw.createdBy ?? null,
        };
      });
      setOrdersUntilTo(arrUntil);
    } catch (e: any) {
      setError(e?.message || tt("admin.clientrep.err.load", "Failed to load data."));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { if (fromStr && toStr) load(); /* eslint-disable-next-line */ }, [fromStr, toStr, tenantId]);

  /** ========= Aggregations ========= */
  // (1) Top clientes por gasto y conteo
  const customersAgg: CustomerAgg[] = useMemo(() => {
    const map = new Map<string, CustomerAgg>();
    for (const o of ordersInRange) {
      const { key, label } = customerKey(o);
      const agg = map.get(key) || { key, label, orders: 0, revenue: 0, firstOrderAt: null };
      agg.orders += 1;
      agg.revenue += getOrderRevenueUSD(o);
      map.set(key, agg);
    }
    // first order time (global hasta 'to')
    if (ordersUntilTo.length > 0) {
      const seenFirst = new Map<string, Date>();
      for (const o of ordersUntilTo) {
        const { key } = customerKey(o);
        const created = toDate(o.createdAt);
        if (!created) continue;
        if (!seenFirst.has(key) || created < (seenFirst.get(key) as Date)) {
          seenFirst.set(key, created);
        }
      }
      for (const agg of map.values()) {
        agg.firstOrderAt = seenFirst.get(agg.key) || null;
      }
    }
    return [...map.values()].sort((a, b) => b.revenue - a.revenue);
  }, [ordersInRange, ordersUntilTo]);

  // (2) New vs Returning
  const periodStart = useMemo(() => new Date(fromStr + "T00:00:00"), [fromStr]);
  const newCustomers = useMemo(() => customersAgg.filter(c => (c.firstOrderAt && c.firstOrderAt >= periodStart)), [customersAgg, periodStart]);
  const returningCustomers = useMemo(() => customersAgg.filter(c => (c.firstOrderAt && c.firstOrderAt < periodStart)), [customersAgg, periodStart]);

  // (3) Order Types / Channels
  const orderTypeCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of ordersInRange) {
      const type = getOrderType(o);
      m.set(type, (m.get(type) || 0) + 1);
    }
    return Array.from(m.entries()).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  }, [ordersInRange]);

  const channelCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of ordersInRange) {
      const ch = getOrderChannel(o);
      if (!ch) continue;
      m.set(ch, (m.get(ch) || 0) + 1);
    }
    return Array.from(m.entries()).map(([label, value]) => ({ label, value })).sort((a, b) => b.value - a.value);
  }, [ordersInRange]);

  // KPIs
  const totalOrders = ordersInRange.length;
  const totalRevenue = useMemo(() => ordersInRange.reduce((s, o) => s + getOrderRevenueUSD(o), 0), [ordersInRange]);

  // Pies
  const pieNewReturning: PieRow[] = useMemo(() => [
    { label: tt("admin.clientrep.new", "New"), value: newCustomers.length },
    { label: tt("admin.clientrep.returning", "Returning"), value: returningCustomers.length },
  ], [newCustomers, returningCustomers, lang]);
  const pieOrderTypes: PieRow[] = useMemo(() => orderTypeCounts.map(r => ({ label: r.label, value: r.value })), [orderTypeCounts]);
  const pieChannels: PieRow[] = useMemo(() => channelCounts.map(r => ({ label: r.label, value: r.value })), [channelCounts]);

  /** ========= Export ========= */
  function onExportExcel() {
    const summary: Sheet = {
      name: "Summary",
      headers: ["Metric", "Value"],
      rows: [
        ["Orders", totalOrders],
        ["Revenue (USD)", Number(totalRevenue.toFixed(2))],
        ["New Customers", newCustomers.length],
        ["Returning Customers", returningCustomers.length],
      ],
    };
    const topCustomers: Sheet = {
      name: "TopCustomers",
      headers: ["Customer", "Orders", "Revenue (USD)", "First order at (UTC)"],
      rows: customersAgg.map(c => [
        c.label,
        c.orders,
        Number(c.revenue.toFixed(2)),
        c.firstOrderAt ? c.firstOrderAt.toISOString().replace("T", " ").slice(0, 19) : "",
      ]),
    };
    const newSheet: Sheet = {
      name: "NewCustomers",
      headers: ["Customer", "Orders (in range)", "Revenue (USD)", "First order at (UTC)"],
      rows: newCustomers.map(c => [
        c.label, c.orders, Number(c.revenue.toFixed(2)),
        c.firstOrderAt ? c.firstOrderAt.toISOString().replace("T", " ").slice(0, 19) : "",
      ]),
    };
    const retSheet: Sheet = {
      name: "ReturningCustomers",
      headers: ["Customer", "Orders (in range)", "Revenue (USD)", "First order at (UTC)"],
      rows: returningCustomers.map(c => [
        c.label, c.orders, Number(c.revenue.toFixed(2)),
        c.firstOrderAt ? c.firstOrderAt.toISOString().replace("T", " ").slice(0, 19) : "",
      ]),
    };
    const typeSheet: Sheet = {
      name: "OrdersByType",
      headers: ["Type", "Orders"],
      rows: orderTypeCounts.map(r => [r.label, r.value]),
    };
    const sheets: Sheet[] = [summary, topCustomers, newSheet, retSheet, typeSheet];

    if (pieChannels.length > 0) {
      sheets.push({
        name: "OrderChannels",
        headers: ["Channel", "Orders"],
        rows: channelCounts.map(r => [r.label, r.value]),
      });
    }

    const xml = buildExcelXml(sheets);
    downloadExcelXml(`client_report_${fromStr}_to_${toStr}.xls`, xml);
  }

  return (
    <Protected>
      <AdminOnly>
        <ToolGate feature="clientReports">
          <main className="container py-4">
            <h1 className="h4 mb-3">{tt("admin.clientrep.title", "Client Reports")}</h1>

            {/* Filters */}
            <div className="card border-0 shadow-sm mb-3">
              <div className="card-body">
                <div className="row g-3">
                  <div className="col-12 col-md-3">
                    <label className="form-label fw-semibold">{tt("admin.clientrep.range", "Range")}</label>
                    <select className="form-select" value={preset} onChange={(e) => setPreset(e.target.value as any)}>
                      <option value="today">{tt("admin.clientrep.preset.today", "Today")}</option>
                      <option value="7d">{tt("admin.clientrep.preset.7d", "Last 7 days")}</option>
                      <option value="30d">{tt("admin.clientrep.preset.30d", "Last 30 days")}</option>
                      <option value="thisMonth">{tt("admin.clientrep.preset.thisMonth", "This month")}</option>
                      <option value="custom">{tt("admin.clientrep.preset.custom", "Custom")}</option>
                    </select>
                  </div>
                  <div className="col-6 col-md-3">
                    <label className="form-label fw-semibold">{tt("admin.clientrep.from", "From")}</label>
                    <input type="date" className="form-control" value={fromStr} onChange={(e) => { setFromStr(e.target.value); setPreset("custom"); }} />
                  </div>
                  <div className="col-6 col-md-3">
                    <label className="form-label fw-semibold">{tt("admin.clientrep.to", "To")}</label>
                    <input type="date" className="form-control" value={toStr} onChange={(e) => { setToStr(e.target.value); setPreset("custom"); }} />
                  </div>
                  <div className="col-12 col-md-3 d-flex align-items-end">
                    <div className="d-flex gap-2 w-100">
                      <button className="btn btn-primary flex-fill" onClick={load} disabled={loading}>
                        {loading ? tt("common.loadingDots", "Loading…") : tt("common.refresh", "Refresh")}
                      </button>
                      <button
                        className="btn btn-outline-success"
                        onClick={onExportExcel}
                        disabled={loading || ordersInRange.length === 0}
                      >
                        {tt("admin.clientrep.export", "Export to Excel")}
                      </button>
                    </div>
                  </div>
                </div>
                {error && <div className="text-danger small mt-2">{error}</div>}
                <div className="text-muted small mt-2">
                  {/* Notes left as comment (no i18n) */}
                </div>
              </div>
            </div>

            {/* KPIs */}
            <div className="row g-3 mb-3">
              <div className="col-6 col-md-3">
                <div className="card border-0 shadow-sm"><div className="card-body">
                  <div className="text-muted small">{tt("admin.clientrep.kpi.orders", "Orders")}</div>
                  <div className="h4 mb-0">{totalOrders}</div>
                </div></div>
              </div>
              <div className="col-6 col-md-3">
                <div className="card border-0 shadow-sm"><div className="card-body">
                  <div className="text-muted small">{tt("admin.clientrep.kpi.revenue", "Revenue")}</div>
                  <div className="h4 mb-0">{money(totalRevenue)}</div>
                </div></div>
              </div>
              <div className="col-6 col-md-3">
                <div className="card border-0 shadow-sm"><div className="card-body">
                  <div className="text-muted small">{tt("admin.clientrep.kpi.newCustomers", "New Customers")}</div>
                  <div className="h4 mb-0">{newCustomers.length}</div>
                </div></div>
              </div>
              <div className="col-6 col-md-3">
                <div className="card border-0 shadow-sm"><div className="card-body">
                  <div className="text-muted small">{tt("admin.clientrep.kpi.returningCustomers", "Returning Customers")}</div>
                  <div className="h4 mb-0">{returningCustomers.length}</div>
                </div></div>
              </div>
            </div>

            {/* Top customers table */}
            <div className="card border-0 shadow-sm mb-3">
              <div className="card-header fw-semibold">{tt("admin.clientrep.table.top.title", "Top Customers by Spend")}</div>
              <div className="card-body p-0">
                <div className="table-responsive">
                  <table className="table mb-0">
                    <thead>
                      <tr>
                        <th>{tt("admin.clientrep.table.top.customer", "Customer")}</th>
                        <th className="text-end">{tt("admin.clientrep.table.top.orders", "Orders")}</th>
                        <th className="text-end">{tt("admin.clientrep.table.top.revenue", "Revenue")}</th>
                        <th className="text-nowrap">{tt("admin.clientrep.table.top.firstAt", "First order at (UTC)")}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {customersAgg.length === 0 && (
                        <tr><td className="text-center text-muted" colSpan={4}>{tt("admin.clientrep.nodata", "No data")}</td></tr>
                      )}
                      {customersAgg.map((c) => (
                        <tr key={c.key}>
                          <td>{c.label === "Guest" ? tt("admin.clientrep.guest", "Guest") : c.label}</td>
                          <td className="text-end">{c.orders}</td>
                          <td className="text-end">{money(c.revenue)}</td>
                          <td className="text-nowrap">
                            {c.firstOrderAt ? c.firstOrderAt.toISOString().replace("T"," ").slice(0,19) : "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Pies */}
            <div className="row g-3">
              <div className="col-12 col-lg-4">
                <PieChart rows={pieNewReturning} title={tt("admin.clientrep.pie.newReturning", "New vs Returning (Customers in range)")} />
              </div>
              <div className="col-12 col-lg-4">
                <PieChart rows={pieOrderTypes} title={tt("admin.clientrep.pie.types", "Orders by Type (Pie)")} />
              </div>
              <div className="col-12 col-lg-4">
                {pieChannels.length > 0 ? (
                  <PieChart rows={pieChannels} title={tt("admin.clientrep.pie.channels", "Order Channels (Pie)")} />
                ) : (
                  <div className="card border-0 shadow-sm h-100">
                    <div className="card-header fw-semibold">{tt("admin.clientrep.pie.channels", "Order Channels (Pie)")}</div>
                    <div className="card-body">
                      <div className="text-muted small">
                        {tt("admin.clientrep.noChannelData",
                          "No channel data. Add <code>orderInfo.orderSource</code> (e.g., <code>app</code>, <code>web</code>, <code>pos</code>) to your orders to enable this chart.")}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </main>
        </ToolGate>
      </AdminOnly>
    </Protected>
  );
}
