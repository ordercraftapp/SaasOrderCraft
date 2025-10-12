// src/app/(tenant)/[tenant]/app/admin/delivery-reports/page.tsx
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
import { useFmtQ /* , fmtCents */ } from "@/lib/settings/money";

// 🔤 i18n
import { t as translate } from "@/lib/i18n/t";
import { useTenantSettings } from "@/lib/settings/hooks";

/** ✅ helpers tenant-aware */
import { tCol } from "@/lib/db";
import { useTenantId } from "@/lib/tenant/context";

/** ========= Types ========= */
type Timeline = {
  assignedAt?: Timestamp | { seconds: number } | Date | null;
  inRouteAt?: Timestamp | { seconds: number } | Date | null; // “driver moving”
  deliveredAt?: Timestamp | { seconds: number } | Date | null;
};

type AddressInfo = {
  line1?: string | null;
  city?: string | null;
  country?: string | null;
  zip?: string | null;
  notes?: string | null;
};

type OrderInfo = {
  type?: "dine-in" | "delivery" | "pickup" | string | null;
  delivery?: string | null;
  addressLabel?: string | null;
  addressInfo?: AddressInfo | null;

  // drivers
  courierName?: string | null;            // ← NUEVO (principal)
  courier?: { uid?: string | null; name?: string | null } | null;
  deliveryDriver?: { uid?: string | null; name?: string | null } | null;
  assignedCourier?: { uid?: string | null; name?: string | null } | null;
  driverName?: string | null;
  driverId?: string | null;

  deliveryTimeline?: Timeline | null;
  statusHistory?: Array<{ status: string; at: Timestamp | { seconds: number } | Date }> | null;
};

type OrderDoc = {
  id: string;
  createdAt?: Timestamp | { seconds: number } | Date | null;
  orderInfo?: OrderInfo | null;
  totals?: { grandTotalWithTax?: number } | null;
  totalsCents?: { grandTotalWithTaxCents?: number } | null;
  payment?: { amount?: number; currency?: string | null } | null;
  orderTotal?: number | null;
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

// ⬇️ Devolvemos monto en unidades (no USD fijo)
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

/** ========= Simple Pie (SVG, no deps) ========= */
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
          {total === 0 ? tt("admin.delrep.nodata", "No data") : tt("admin.delrep.segments", "{n} segments", { n: rows.length })}
        </span>
      </div>
      <div className="card-body">
        {total === 0 ? (
          <div className="text-muted small">{tt("admin.delrep.nodata", "No data")}</div>
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
export default function AdminDeliveryReportsPage() {
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
  const [error, setError] = useState<string | null>(null);

  async function load() {
    if (!tenantId) return;
    setError(null); setLoading(true);
    try {
      const from = new Date(fromStr + "T00:00:00");
      const to = new Date(toStr + "T23:59:59.999");

      const qRef = query(
        tCol("orders", tenantId),
        where("createdAt", ">=", Timestamp.fromDate(from)),
        where("createdAt", "<=", Timestamp.fromDate(to)),
        orderBy("createdAt", "asc"),
      );
      const snap = await getDocs(qRef);

      const arr: OrderDoc[] = snap.docs
        .map((d) => {
          const raw = d.data() as DocumentData;
          return {
            id: d.id,
            createdAt: raw.createdAt ?? null,
            orderInfo: raw.orderInfo ?? null,
            totals: raw.totals ?? null,
            totalsCents: raw.totalsCents ?? null,
            payment: raw.payment ?? null,
            orderTotal: Number.isFinite(raw.orderTotal) ? Number(raw.orderTotal) : null,
          };
        })
        .filter((o) => (o.orderInfo?.type || "").toString() === "delivery"); // solo delivery
      setOrders(arr);
    } catch (e: any) {
      setError(e?.message || tt("admin.delrep.err.load", "Failed to load data."));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { if (fromStr && toStr) load(); /* eslint-disable-next-line */ }, [fromStr, toStr, tenantId]);

  /** ========= Aggregations ========= */
  // Moneda detectada (si hay)
  const currency = useMemo(() => orders[0]?.payment?.currency || "USD", [orders]);

  // Driver identity resolver (flex)
  function driverKeyAndName(oi?: OrderInfo | null): { key: string; name: string } {
    // 1) principal: texto plano courierName
    const cn = (oi?.courierName || "").trim();
    if (cn) return { key: `name:${cn}`, name: cn };

    // 2) objetos comunes con uid/name
    const c = oi?.courier || oi?.deliveryDriver || oi?.assignedCourier || null;
    if (c?.uid || c?.name) {
      const key = c?.uid ? `uid:${c.uid}` : `name:${c?.name || tt("admin.delrep.unknown", "Unknown")}`;
      return { key, name: c?.name || c?.uid || tt("admin.delrep.unknown", "Unknown") };
    }

    // 3) campos planos legacy
    if (oi?.driverName) return { key: `name:${oi.driverName}`, name: oi.driverName };
    if (oi?.driverId)   return { key: `uid:${oi.driverId}`,   name: oi.driverId };

    // 4) sin asignar
    return { key: "unassigned", name: tt("admin.delrep.unassigned", "Unassigned") };
  }

  // Orders by driver
  const byDriver = useMemo(() => {
    const m = new Map<string, { name: string; orders: number; revenue: number }>();
    for (const o of orders) {
      const d = driverKeyAndName(o.orderInfo);
      const cur = m.get(d.key) || { name: d.name, orders: 0, revenue: 0 };
      cur.orders += 1;
      cur.revenue += getOrderRevenue(o);
      m.set(d.key, cur);
    }
    return Array.from(m.entries()).map(([key, v]) => ({ key, ...v })).sort((a, b) => b.orders - a.orders);
  }, [orders]);

  // Delivery zones (by city / zip)
  const zonesByCity = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of orders) {
      const city = (o.orderInfo?.addressInfo?.city || tt("admin.delrep.unknown", "Unknown")).toString();
      m.set(city, (m.get(city) || 0) + 1);
    }
    return Array.from(m.entries()).map(([label, value]) => ({ label, value })).sort((a,b)=> b.value - a.value);
  }, [orders]);

  const zonesByZip = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of orders) {
      const zip = (o.orderInfo?.addressInfo?.zip || tt("admin.delrep.unknown", "Unknown")).toString();
      m.set(zip, (m.get(zip) || 0) + 1);
    }
    return Array.from(m.entries()).map(([label, value]) => ({ label, value })).sort((a,b)=> b.value - a.value);
  }, [orders]);

  // Delivery times (inRouteAt -> deliveredAt)
  function timelineFromOrder(o: OrderDoc): Timeline | null {
    const t = o.orderInfo?.deliveryTimeline;
    if (t) return t;

    // fallback: buscar en statusHistory
    const hist = o.orderInfo?.statusHistory || [];
    if (Array.isArray(hist) && hist.length > 0) {
      const inRoute = hist.find((h) => String(h.status).toLowerCase().includes("route"));
      const delivered = hist.find((h) => String(h.status).toLowerCase().includes("deliver"));
      return {
        inRouteAt: inRoute?.at ?? null,
        deliveredAt: delivered?.at ?? null,
      };
    }
    return null;
  }

  const deliveryDurations = useMemo(() => {
    // devuelve duraciones en minutos
    const rows: { orderId: string; inRouteAt?: Date | null; deliveredAt?: Date | null; minutes?: number | null }[] = [];
    for (const o of orders) {
      const tl = timelineFromOrder(o);
      if (!tl) { rows.push({ orderId: o.id, inRouteAt: undefined, deliveredAt: undefined, minutes: null }); continue; }
      const a = toDate(tl.inRouteAt);
      const b = toDate(tl.deliveredAt);
      const minutes = a && b ? Math.max(0, (b.getTime() - a.getTime()) / 60000) : null;
      rows.push({ orderId: o.id, inRouteAt: a, deliveredAt: b, minutes });
    }
    return rows;
  }, [orders]);

  const avgDeliveryMinutes = useMemo(() => {
    const vals = deliveryDurations.map((r) => r.minutes).filter((x): x is number => Number.isFinite(x as number));
    if (!vals.length) return null;
    const sum = vals.reduce((s, n) => s + n, 0);
    return sum / vals.length;
  }, [deliveryDurations]);

  // Pies
  const pieDrivers: PieRow[] = useMemo(() => byDriver.slice(0, 8).map(d => ({ label: d.name, value: d.orders })), [byDriver]);
  const pieZonesCity: PieRow[] = useMemo(() => zonesByCity.slice(0, 8).map(z => ({ label: z.label, value: z.value })), [zonesByCity]);

  // KPIs
  const totalOrders = orders.length;
  const totalRevenue = useMemo(() => orders.reduce((s, o) => s + getOrderRevenue(o), 0), [orders]);

  /** ========= Export ========= */
  function onExportExcel() {
    const driversSheet: Sheet = {
      name: "Drivers",
      headers: ["Driver", "Orders", `Revenue (${currency})`],
      rows: byDriver.map(d => [d.name, d.orders, Number(d.revenue.toFixed(2))]),
    };
    const timesSheet: Sheet = {
      name: "DeliveryTimes",
      headers: ["OrderId", "InRouteAt (UTC)", "DeliveredAt (UTC)", "Minutes"],
      rows: deliveryDurations.map(r => [
        r.orderId,
        r.inRouteAt ? r.inRouteAt.toISOString().replace("T"," ").slice(0,19) : "",
        r.deliveredAt ? r.deliveredAt.toISOString().replace("T"," ").slice(0,19) : "",
        Number.isFinite(r.minutes as any) ? Number((r.minutes as number).toFixed(1)) : "",
      ]),
    };
    const zonesCitySheet: Sheet = {
      name: "ZonesByCity",
      headers: ["City", "Orders"],
      rows: zonesByCity.map(z => [z.label, z.value]),
    };
    const zonesZipSheet: Sheet = {
      name: "ZonesByZip",
      headers: ["ZIP", "Orders"],
      rows: zonesByZip.map(z => [z.label, z.value]),
    };
    const ordersSheet: Sheet = {
      name: "Orders",
      headers: ["OrderId", "CreatedAt (UTC)", "Driver", "City", "ZIP", `Revenue (${currency})`],
      rows: orders.map(o => {
        const d = driverKeyAndName(o.orderInfo);
        const city = o.orderInfo?.addressInfo?.city || "";
        const zip = o.orderInfo?.addressInfo?.zip || "";
        return [
          o.id,
          toDate(o.createdAt)?.toISOString().replace("T"," ").slice(0,19) || "",
          d.name,
          city,
          zip,
          Number(getOrderRevenue(o).toFixed(2)),
        ];
      }),
    };

    const xml = buildExcelXml([driversSheet, timesSheet, zonesCitySheet, zonesZipSheet, ordersSheet]);
    downloadExcelXml(`delivery_report_${fromStr}_to_${toStr}.xls`, xml);
  }

  return (
    <Protected>
      <AdminOnly>
        <ToolGate feature="deliveryReports">
          <main className="container py-4">
            <h1 className="h4 mb-3">{tt("admin.delrep.title", "Delivery Reports")}</h1>

            {/* Filters */}
            <div className="card border-0 shadow-sm mb-3">
              <div className="card-body">
                <div className="row g-3">
                  <div className="col-12 col-md-3">
                    <label className="form-label fw-semibold">{tt("admin.delrep.range", "Range")}</label>
                    <select className="form-select" value={preset} onChange={(e) => setPreset(e.target.value as any)}>
                      <option value="today">{tt("admin.delrep.preset.today", "Today")}</option>
                      <option value="7d">{tt("admin.delrep.preset.7d", "Last 7 days")}</option>
                      <option value="30d">{tt("admin.delrep.preset.30d", "Last 30 days")}</option>
                      <option value="thisMonth">{tt("admin.delrep.preset.thisMonth", "This month")}</option>
                      <option value="custom">{tt("admin.delrep.preset.custom", "Custom")}</option>
                    </select>
                  </div>
                  <div className="col-6 col-md-3">
                    <label className="form-label fw-semibold">{tt("admin.delrep.from", "From")}</label>
                    <input type="date" className="form-control" value={fromStr} onChange={(e) => { setFromStr(e.target.value); setPreset("custom"); }} />
                  </div>
                  <div className="col-6 col-md-3">
                    <label className="form-label fw-semibold">{tt("admin.delrep.to", "To")}</label>
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
                        disabled={loading || orders.length === 0}
                      >
                        {tt("admin.delrep.export", "Export to Excel")}
                      </button>
                    </div>
                  </div>
                </div>
                {error && <div className="text-danger small mt-2">{error}</div>}

                <div className="text-muted small mt-2">
                  {tt("admin.delrep.notes.main", "Uses")} <code>orderInfo</code> {tt("admin.delrep.notes.cont1", "from checkout (delivery address & options). To compute delivery times, store timestamps for")} <em>inRouteAt</em> {tt("admin.delrep.notes.cont2", "and")} <em>deliveredAt</em> {tt("admin.delrep.notes.cont3", "in")} <code>orderInfo.deliveryTimeline</code> {tt("admin.delrep.notes.cont4", "or a")} <code>statusHistory</code> {tt("admin.delrep.notes.cont5", "array.")}
                </div>
              </div>
            </div>

            {/* KPIs */}
            <div className="row g-3 mb-3">
              <div className="col-6 col-md-3">
                <div className="card border-0 shadow-sm"><div className="card-body">
                  <div className="text-muted small">{tt("admin.delrep.kpi.deliveryOrders", "Delivery orders")}</div>
                  <div className="h4 mb-0">{totalOrders}</div>
                </div></div>
              </div>
              <div className="col-6 col-md-3">
                <div className="card border-0 shadow-sm"><div className="card-body">
                  <div className="text-muted small">{tt("admin.delrep.kpi.revenue", "Revenue")}</div>
                  <div className="h4 mb-0">{fmtQ(totalRevenue)}</div>
                </div></div>
              </div>
              <div className="col-12 col-md-6">
                <div className="card border-0 shadow-sm"><div className="card-body">
                  <div className="text-muted small">{tt("admin.delrep.kpi.avg", "Avg delivery time (in route → delivered)")}</div>
                  <div className="h5 mb-0">{avgDeliveryMinutes != null ? `${avgDeliveryMinutes.toFixed(1)} ${tt("admin.delrep.min", "min")}` : tt("admin.delrep.na", "N/A")}</div>
                  <div className="small text-muted mt-1">
                    {tt("admin.delrep.kpi.avgHint", "If “N/A”, add")} <code>orderInfo.deliveryTimeline.inRouteAt</code> &amp; <code>deliveredAt</code> {tt("admin.delrep.kpi.avgHint2", "or a")} <code>statusHistory</code> {tt("admin.delrep.kpi.avgHint3", "entry for those steps.")}
                  </div>
                </div></div>
              </div>
            </div>

            {/* Tables */}
            <div className="row g-3">
              <div className="col-12 col-lg-6">
                <div className="card border-0 shadow-sm h-100">
                  <div className="card-header fw-semibold">{tt("admin.delrep.table.byDriver.title", "Orders by Driver")}</div>
                  <div className="card-body p-0">
                    <div className="table-responsive">
                      <table className="table mb-0">
                        <thead>
                          <tr>
                            <th>{tt("admin.delrep.table.byDriver.driver", "Driver")}</th>
                            <th className="text-end">{tt("admin.delrep.table.byDriver.orders", "Orders")}</th>
                            <th className="text-end">{tt("admin.delrep.table.byDriver.revenue", "Revenue")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {byDriver.length === 0 && <tr><td colSpan={3} className="text-center text-muted">{tt("admin.delrep.nodata", "No data")}</td></tr>}
                          {byDriver.map((d) => (
                            <tr key={d.key}>
                              <td>{d.name}</td>
                              <td className="text-end">{d.orders}</td>
                              <td className="text-end">{fmtQ(d.revenue)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div className="card-footer small text-muted">
                    {tt("admin.delrep.table.byDriver.hint", "Driver can be read from")} <code>orderInfo.courier</code>, <code>orderInfo.deliveryDriver</code>, <code>orderInfo.assignedCourier</code>, {tt("admin.delrep.table.byDriver.or", "or flat")} <code>driverName</code>/<code>driverId</code>.
                  </div>
                </div>
              </div>

              <div className="col-12 col-lg-6">
                <div className="card border-0 shadow-sm h-100">
                  <div className="card-header fw-semibold">{tt("admin.delrep.table.times.title", "Delivery Times (in route → delivered)")}</div>
                  <div className="card-body p-0">
                    <div className="table-responsive">
                      <table className="table mb-0">
                        <thead>
                          <tr>
                            <th>{tt("admin.delrep.table.times.order", "Order")}</th>
                            <th>InRouteAt</th>
                            <th>DeliveredAt</th>
                            <th className="text-end">{tt("admin.delrep.table.times.minutes", "Minutes")}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {deliveryDurations.length === 0 && <tr><td colSpan={4} className="text-center text-muted">{tt("admin.delrep.nodata", "No data")}</td></tr>}
                          {deliveryDurations.map((r) => (
                            <tr key={r.orderId}>
                              <td className="text-nowrap">{r.orderId}</td>
                              <td className="text-nowrap">{r.inRouteAt ? r.inRouteAt.toISOString().replace("T"," ").slice(0,19) : "—"}</td>
                              <td className="text-nowrap">{r.deliveredAt ? r.deliveredAt.toISOString().replace("T"," ").slice(0,19) : "—"}</td>
                              <td className="text-end">{Number.isFinite(r.minutes as any) ? (r.minutes as number).toFixed(1) : "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                  <div className="card-footer small text-muted">
                    {tt("admin.delrep.table.times.hint", "Populate")} <code>orderInfo.deliveryTimeline</code> {tt("admin.delrep.table.times.or", "or")} <code>statusHistory</code> {tt("admin.delrep.table.times.hint2", "to enable exact durations.")}
                  </div>
                </div>
              </div>
            </div>

            {/* Zones */}
            <div className="card border-0 shadow-sm mt-3">
              <div className="card-header fw-semibold">{tt("admin.delrep.zones.title", "Delivery Zones")}</div>
              <div className="card-body p-0">
                <div className="table-responsive">
                  <table className="table mb-0">
                    <thead>
                      <tr>
                        <th>{tt("admin.delrep.zones.city", "City")}</th>
                        <th className="text-end">{tt("admin.delrep.zones.orders", "Orders")}</th>
                        <th className="d-none d-md-table-cell">ZIP</th>
                      </tr>
                    </thead>
                    <tbody>
                      {zonesByCity.length === 0 && <tr><td colSpan={3} className="text-center text-muted">{tt("admin.delrep.nodata", "No data")}</td></tr>}
                      {zonesByCity.map((z) => (
                        <tr key={`city-${z.label}`}>
                          <td>{z.label}</td>
                          <td className="text-end">{z.value}</td>
                          <td className="d-none d-md-table-cell">
                            {/* hint dinámico: top zip para esa city */}
                            {zonesByZip.filter(x => x.label && x.value && x.label !== "Unknown").slice(0,1).map(x => x.label).join("") || "—"}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Pies */}
            <div className="row g-3 mt-3">
              <div className="col-12 col-lg-6">
                <PieChart rows={pieDrivers} title={tt("admin.delrep.pie.drivers", "Orders by Driver (Pie)")} />
              </div>
              <div className="col-12 col-lg-6">
                <PieChart rows={pieZonesCity} title={tt("admin.delrep.pie.zonesCity", "Top Zones by City (Pie)")} />
              </div>
            </div>

            {/* Implementation guide */}
            <div className="card border-0 shadow-sm mt-3">
              <div className="card-header fw-semibold">{tt("admin.delrep.howto.title", "How to enable delivery timing & assignment")}</div>
              <div className="card-body">
                <ol className="small mb-2">
                  <li><strong>{tt("admin.delrep.howto.assign", "Assign driver")}:</strong> {tt("admin.delrep.howto.assignHint", "set")} <code>orderInfo.courier</code> = {'{ uid, name }'} {tt("admin.delrep.howto.assignAt", "on assignment.")}</li>
                  <li><strong>{tt("admin.delrep.howto.inroute", "Mark “in route”")}:</strong> {tt("admin.delrep.howto.set", "set")} <code>orderInfo.deliveryTimeline.inRouteAt = serverTimestamp()</code>.</li>
                  <li><strong>{tt("admin.delrep.howto.delivered", "Mark “delivered”")}:</strong> {tt("admin.delrep.howto.set", "set")} <code>orderInfo.deliveryTimeline.deliveredAt = serverTimestamp()</code>.</li>
                </ol>
              </div>
            </div>

            <div className="text-muted small mt-3">
              {tt("admin.delrep.tip", "Tip: If Firestore suggests a composite index for")} <code>createdAt</code> {tt("admin.delrep.tip2", "range queries, follow its link to create it.")}
            </div>
          </main>
        </ToolGate>
      </AdminOnly>
    </Protected>
  );
}
