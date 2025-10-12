// src/app/(tenant)/[tenant]/app/admin/product-reports/page.tsx
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
import { useFmtQ } from "@/lib/settings/money";

// 🔤 i18n
import { t as translate } from "@/lib/i18n/t";
import { useTenantSettings } from "@/lib/settings/hooks";

// ✅ helpers tenant-aware
import { tCol } from "@/lib/db";
import { useTenantId } from "@/lib/tenant/context";

/** ===== Types ===== */
type OrderItem = {
  menuItemId: string;
  menuItemName: string;
  basePrice?: number;
  quantity: number;
  lineTotal?: number; // incluye addons y options
  addons?: Array<{ name: string; price?: number }>;
  optionGroups?: Array<{
    groupId: string;
    groupName: string;
    type?: "single" | "multi";
    items: Array<{ id: string; name: string; priceDelta?: number }>;
  }>;
};

type OrderDoc = {
  id: string;
  createdAt?: Timestamp | { seconds: number } | Date | null;
  items?: OrderItem[];
  orderInfo?: { type?: "dine-in" | "delivery" | "pickup" | string } | null;
  orderTotal?: number;
  payment?: { amount?: number; currency?: string | null } | null;
  totals?: { grandTotalWithTax?: number } | null;
  totalsCents?: { grandTotalWithTaxCents?: number } | null;
};

type MenuOptionItemDef = { id: string; name: string; priceDelta?: number };
type MenuOptionGroupDef = {
  groupId: string;
  groupName: string;
  type?: "single" | "multi";
  items?: MenuOptionItemDef[];
};
type MenuAddonDef = { name: string; price?: number };

type MenuMeta = {
  id: string;
  name?: string;
  categoryId?: string | null;
  subcategoryId?: string | null;
  category?: string;
  subcategory?: string;
  addons?: MenuAddonDef[];
  optionGroups?: MenuOptionGroupDef[];
};

type Period = "day" | "week" | "month";

/** ===== Utilities ===== */
function toDate(v: any): Date | null {
  if (!v) return null;
  if (v instanceof Date) return v;
  if (v?.seconds != null) return new Date(v.seconds * 1000);
  try { return new Date(v); } catch { return null; }
}

function getOrderRevenue(o: OrderDoc): number {
  const cents = o.totalsCents?.grandTotalWithTaxCents;
  if (Number.isFinite(cents)) return (cents as number) / 100;
  const withTax = o.totals?.grandTotalWithTax;
  if (Number.isFinite(withTax)) return withTax as number;
  const pay = o.payment?.amount;
  if (Number.isFinite(pay)) return pay as number;
  const legacy = o.orderTotal;
  if (Number.isFinite(legacy)) return legacy as number;
  return 0;
}

/** ===== Pie Chart (SVG, no deps) ===== */
type PieRow = { label: string; value: number; color?: string };
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
  formatValue,
}: {
  rows: PieRow[];
  size?: number;
  title: string;
  formatValue?: (n: number) => string | number;
}) {
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
          {total === 0 ? tt("admin.prodrep.nodata", "No data") : tt("admin.prodrep.segments", "{n} segments", { n: rows.length })}
        </span>
      </div>
      <div className="card-body">
        {total === 0 ? (
          <div className="text-muted small">{tt("admin.prodrep.nodata", "No data")}</div>
        ) : (
          <div className="d-flex flex-column flex-md-row align-items-center gap-3">
            <div style={{ width: "100%", maxWidth: size }}>
              <svg viewBox={`0 0 ${size} ${size}`} style={{ width: "100%", height: "auto" }}>
                {slices.map((s) => <path key={s.key} d={s.d} fill={s.fill} stroke="white" strokeWidth="1" />)}
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
                    <div className="small text-muted">
                      {formatValue ? formatValue(s.value) : s.value} · {(s.pct * 100).toFixed(1)}%
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

/** ===== Excel (SpreadsheetML 2003) ===== */
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

/** ===== Page ===== */
export default function AdminProductReportPage() {
  const tenantId = useTenantId() as string;
  const db = getFirestore();
  const fmtQ = useFmtQ();

  // 🔤 i18n init
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
    const from = new Date(); from.setDate(from.getDate() - 29); from.setHours(0,0,0,0);
    setFromStr(from.toISOString().slice(0,10));
    setToStr(to.toISOString().slice(0,10));
  }, []);
  useEffect(() => {
    if (preset === "custom") return;
    const now = new Date();
    if (preset === "today") {
      const f = new Date(now); f.setHours(0,0,0,0);
      const t = new Date(now); t.setHours(23,59,59,999);
      setFromStr(f.toISOString().slice(0,10));
      setToStr(t.toISOString().slice(0,10));
      return;
    }
    if (preset === "7d") {
      const f = new Date(); f.setDate(f.getDate()-6); f.setHours(0,0,0,0);
      const t = new Date(now); t.setHours(23,59,59,999);
      setFromStr(f.toISOString().slice(0,10));
      setToStr(t.toISOString().slice(0,10));
      return;
    }
    if (preset === "30d") {
      const f = new Date(); f.setDate(f.getDate()-29); f.setHours(0,0,0,0);
      const t = new Date(now); t.setHours(23,59,59,999);
      setFromStr(f.toISOString().slice(0,10));
      setToStr(t.toISOString().slice(0,10));
      return;
    }
    if (preset === "thisMonth") {
      const f = new Date(now.getFullYear(), now.getMonth(), 1);
      const t = new Date(now.getFullYear(), now.getMonth()+1, 0);
      setFromStr(f.toISOString().slice(0,10));
      setToStr(t.toISOString().slice(0,10));
      return;
    }
  }, [preset]);

  // Data state
  const [loading, setLoading] = useState(false);
  const [orders, setOrders] = useState<OrderDoc[]>([]);
  const [menuMeta, setMenuMeta] = useState<Record<string, MenuMeta>>({});
  const [error, setError] = useState<string | null>(null);

  /** ===== Load orders + catalog with category resolution (tenant scoped) ===== */
  async function load() {
    if (!tenantId) return;
    setError(null);
    setLoading(true);
    try {
      const from = new Date(fromStr + "T00:00:00");
      const to = new Date(toStr + "T23:59:59.999");

      // Orders in range
      const qRef = query(
        tCol("orders", tenantId),
        where("createdAt", ">=", Timestamp.fromDate(from)),
        where("createdAt", "<=", Timestamp.fromDate(to)),
        orderBy("createdAt", "asc")
      );
      const snap = await getDocs(qRef);
      const arr: OrderDoc[] = snap.docs.map((d) => {
        const raw = d.data() as DocumentData;
        return {
          id: d.id,
          createdAt: raw.createdAt ?? null,
          items: Array.isArray(raw.items) ? raw.items : [],
          orderInfo: raw.orderInfo ?? null,
          orderTotal: Number(raw.orderTotal ?? raw?.totals?.grandTotalWithTax ?? 0),
          payment: raw.payment ?? null,
          totals: raw.totals ?? null,
          totalsCents: raw.totalsCents ?? null,
        };
      });
      setOrders(arr);

      // Catalog (tenant collections)
      const catSnap = await getDocs(tCol("categories", tenantId));
      const catMap: Record<string, string> = {};
      for (const d of catSnap.docs) {
        const r = d.data() as any;
        const nm = (r?.name ?? r?.title ?? "").toString() || d.id;
        catMap[d.id] = nm;
      }

      const subSnap = await getDocs(tCol("subcategories", tenantId));
      const subMap: Record<string, string> = {};
      for (const d of subSnap.docs) {
        const r = d.data() as any;
        const nm = (r?.name ?? r?.title ?? "").toString() || d.id;
        subMap[d.id] = nm;
      }

      const menuSnap = await getDocs(tCol("menuItems", tenantId));
      const meta: Record<string, MenuMeta> = {};
      for (const d of menuSnap.docs) {
        const r = d.data() as any;
        const categoryId = (r?.categoryId ?? null) as string | null;
        const subcategoryId = (r?.subcategoryId ?? null) as string | null;

        const addonDefs: MenuAddonDef[] = Array.isArray(r?.addons)
          ? r.addons.map((a: any) => ({ name: String(a?.name || "Unnamed Addon"), price: Number(a?.price ?? 0) }))
          : Array.isArray(r?.addonDefs)
          ? r.addonDefs.map((a: any) => ({ name: String(a?.name || "Unnamed Addon"), price: Number(a?.price ?? 0) }))
          : [];

        const optionGroupsDefs: MenuOptionGroupDef[] = Array.isArray(r?.optionGroups)
          ? r.optionGroups.map((g: any) => ({
              groupId: String(g?.groupId || g?.id || ""),
              groupName: String(g?.groupName || g?.name || "Options"),
              type: (g?.type as any) || "single",
              items: Array.isArray(g?.items)
                ? g.items.map((it: any) => ({
                    id: String(it?.id || ""),
                    name: String(it?.name || "Item"),
                    priceDelta: Number(it?.priceDelta ?? 0),
                  }))
                : [],
            }))
          : Array.isArray(r?.options)
          ? r.options.map((g: any) => ({
              groupId: String(g?.groupId || g?.id || ""),
              groupName: String(g?.groupName || g?.name || "Options"),
              type: (g?.type as any) || "single",
              items: Array.isArray(g?.items)
                ? g.items.map((it: any) => ({
                    id: String(it?.id || ""),
                    name: String(it?.name || "Item"),
                    priceDelta: Number(it?.priceDelta ?? 0),
                  }))
                : [],
            }))
          : [];

        meta[d.id] = {
          id: d.id,
          name: r?.name,
          categoryId,
          subcategoryId,
          category: categoryId && catMap[categoryId] ? catMap[categoryId] : "Unknown",
          subcategory: subcategoryId && subMap[subcategoryId] ? subMap[subcategoryId] : "Unknown",
          addons: addonDefs,
          optionGroups: optionGroupsDefs,
        };
      }
      setMenuMeta(meta);
    } catch (e: any) {
      setError(e?.message || tt("admin.prodrep.err.load", "Failed to load data."));
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { if (fromStr && toStr) load(); /* eslint-disable-next-line */ }, [fromStr, toStr, tenantId]);

  /** ===== Aggregations ===== */
  type ItemAgg = {
    id: string;
    name: string;
    category: string;
    subcategory: string;
    qty: number;
    orders: number;
    revenue: number;
  };
  const itemAggs: ItemAgg[] = useMemo(() => {
    const by: Record<string, ItemAgg> = {};
    for (const o of orders) {
      const lines = o.items || [];
      for (const ln of lines) {
        const id = ln.menuItemId || ln.menuItemName || "unknown";
        const meta = menuMeta[id] || {};
        const key = id;
        if (!by[key]) {
          by[key] = {
            id,
            name: ln.menuItemName || (meta as any).name || "Unnamed",
            category: (meta as any).category || "Unknown",
            subcategory: (meta as any).subcategory || "Unknown",
            qty: 0,
            orders: 0,
            revenue: 0,
          };
        }
        const q = Number(ln.quantity || 0);
        const rev = Number(ln.lineTotal || 0);
        by[key].qty += q;
        by[key].orders += 1;
        by[key].revenue += rev;
      }
    }
    return Object.values(by);
  }, [orders, menuMeta]);

  const topGlobal = useMemo(() => [...itemAggs].sort((a,b) => b.qty - a.qty).slice(0, 10), [itemAggs]);
  const least = useMemo(() => [...itemAggs].sort((a,b) => a.qty - b.qty).slice(0, 10), [itemAggs]);

  const topByCategory = useMemo(() => {
    const byCat: Record<string, ItemAgg[]> = {};
    for (const it of itemAggs) {
      byCat[it.category] = byCat[it.category] || [];
      byCat[it.category].push(it);
    }
    const rows: { category: string; items: ItemAgg[] }[] = [];
    for (const [cat, arr] of Object.entries(byCat)) {
      rows.push({ category: cat, items: arr.sort((a,b)=> b.qty - a.qty).slice(0,10) });
    }
    return rows.sort((a,b)=> a.category.localeCompare(b.category));
  }, [itemAggs]);

  const revenueByCategory = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of itemAggs) m.set(it.category, (m.get(it.category) || 0) + it.revenue);
    return Array.from(m.entries()).map(([category, revenue]) => ({ category, revenue }))
      .sort((a,b)=> b.revenue - a.revenue);
  }, [itemAggs]);

  const revenueBySubcategory = useMemo(() => {
    const m = new Map<string, number>();
    for (const it of itemAggs) {
      const key = `${it.category} / ${it.subcategory}`;
      m.set(key, (m.get(key) || 0) + it.revenue);
    }
    return Array.from(m.entries()).map(([subset, revenue]) => ({ subset, revenue }))
      .sort((a,b)=> b.revenue - a.revenue);
  }, [itemAggs]);

  type ExtraAgg = { label: string; count: number; revenue: number };
  const addonsAgg: ExtraAgg[] = useMemo(() => {
    const m = new Map<string, ExtraAgg>();
    for (const o of orders) {
      for (const ln of (o.items || [])) {
        for (const ad of (ln.addons || [])) {
          const label = ad.name || "Unnamed Addon";
          const revenue = Number(ad.price || 0) * Number(ln.quantity || 1);
          const cur = m.get(label) || { label, count: 0, revenue: 0 };
          cur.count += Number(ln.quantity || 1);
          cur.revenue += revenue;
          m.set(label, cur);
        }
      }
    }
    return Array.from(m.values()).sort((a,b)=> b.count - a.count);
  }, [orders]);

  const optionsAgg: ExtraAgg[] = useMemo(() => {
    const m = new Map<string, ExtraAgg>();
    for (const o of orders) {
      for (const ln of (o.items || [])) {
        for (const g of (ln.optionGroups || [])) {
          for (const it of g.items || []) {
            const label = `${g.groupName}: ${it.name}`;
            const revenue = Number(it.priceDelta || 0) * Number(ln.quantity || 1);
            const cur = m.get(label) || { label, count: 0, revenue: 0 };
            cur.count += Number(ln.quantity || 1);
            cur.revenue += revenue;
            m.set(label, cur);
          }
        }
      }
    }
    return Array.from(m.values()).sort((a,b)=> b.count - a.count);
  }, [orders]);

  const catalogAddonLabels = useMemo(() => {
    const set = new Set<string>();
    Object.values(menuMeta).forEach((mi) => (mi.addons || []).forEach((ad) => set.add(ad.name || "Unnamed Addon")));
    return set;
  }, [menuMeta]);

  const catalogOptionItemLabels = useMemo(() => {
    const set = new Set<string>();
    Object.values(menuMeta).forEach((mi) =>
      (mi.optionGroups || []).forEach((g) =>
        (g.items || []).forEach((it) => set.add(`${g.groupName || "Options"}: ${it.name || "Item"}`))
      )
    );
    return set;
  }, [menuMeta]);

  const usedAddonLabels = useMemo(() => new Set(addonsAgg.map(a => a.label)), [addonsAgg]);
  const usedOptionLabels = useMemo(() => new Set(optionsAgg.map(a => a.label)), [optionsAgg]);

  const neverUsedAddons = useMemo(
    () => Array.from(catalogAddonLabels).filter(lbl => !usedAddonLabels.has(lbl)).sort((a,b)=> a.localeCompare(b)),
    [catalogAddonLabels, usedAddonLabels]
  );
  const neverUsedOptions = useMemo(
    () => Array.from(catalogOptionItemLabels).filter(lbl => !usedOptionLabels.has(lbl)).sort((a,b)=> a.localeCompare(b)),
    [catalogOptionItemLabels, usedOptionLabels]
  );

  const allMenuItemsList = useMemo(() => Object.values(menuMeta), [menuMeta]);
  const soldItemIds = useMemo(() => new Set(itemAggs.map(i => i.id)), [itemAggs]);
  const neverOrderedItems = useMemo(() =>
    allMenuItemsList
      .filter(mi => !soldItemIds.has(mi.id))
      .map(mi => ({ id: mi.id, name: mi.name || "Unnamed", category: mi.category || "Unknown", subcategory: mi.subcategory || "Unknown" }))
      .sort((a,b)=> a.category.localeCompare(b.category) || a.name.localeCompare(b.name)),
    [allMenuItemsList, soldItemIds]
  );

  const pieByCategory: PieRow[] = useMemo(
    () => revenueByCategory.map(r => ({ label: r.category, value: r.revenue })),
    [revenueByCategory]
  );
  const pieBySubcategory: PieRow[] = useMemo(
    () => revenueBySubcategory.map(r => ({ label: r.subset, value: r.revenue })),
    [revenueBySubcategory]
  );
  const pieExtras: PieRow[] = useMemo(() => {
    const addonsTotal = addonsAgg.reduce((s,a)=> s+a.revenue, 0);
    const optionsTotal = optionsAgg.reduce((s,a)=> s+a.revenue, 0);
    return [
      { label: translate(lang, "admin.prodrep.extras.addons") || "Addons", value: addonsTotal },
      { label: translate(lang, "admin.prodrep.extras.optionItems") || "Option items", value: optionsTotal },
    ];
  }, [addonsAgg, optionsAgg, lang]);

  const totalOrders = orders.length;
  const totalRevenue = useMemo(() => orders.reduce((sum, o) => sum + getOrderRevenue(o), 0), [orders]);
  const currency = useMemo(() => orders[0]?.payment?.currency || "USD", [orders]);

  function onExportExcel() {
    const topGlobalSheet: Sheet = {
      name: "TopGlobal",
      headers: [
        tt("admin.prodrep.th.item", "Item"),
        tt("admin.prodrep.th.category", "Category"),
        tt("admin.prodrep.th.subcategory", "Subcategory"),
        tt("admin.prodrep.th.qty", "Qty"),
        tt("admin.prodrep.th.orders", "Orders"),
        `${tt("admin.prodrep.kpi.revenue", "Revenue")} (${currency})`,
      ],
      rows: topGlobal.map(t => [t.name, t.category, t.subcategory, t.qty, t.orders, Number(t.revenue.toFixed(2))]),
    };
    const topByCatSheet: Sheet = {
      name: "TopByCategory",
      headers: [
        tt("admin.prodrep.th.category", "Category"),
        tt("admin.prodrep.th.item", "Item"),
        tt("admin.prodrep.th.qty", "Qty"),
        tt("admin.prodrep.th.orders", "Orders"),
        `${tt("admin.prodrep.kpi.revenue", "Revenue")} (${currency})`,
      ],
      rows: topByCategory.flatMap(grp =>
        grp.items.map(it => [grp.category, it.name, it.qty, it.orders, Number(it.revenue.toFixed(2))])
      ),
    };
    const leastSheet: Sheet = {
      name: "Least",
      headers: [
        tt("admin.prodrep.th.item", "Item"),
        tt("admin.prodrep.th.category", "Category"),
        tt("admin.prodrep.th.subcategory", "Subcategory"),
        tt("admin.prodrep.th.qty", "Qty"),
        tt("admin.prodrep.th.orders", "Orders"),
        `${tt("admin.prodrep.kpi.revenue", "Revenue")} (${currency})`,
      ],
      rows: least.map(t => [t.name, t.category, t.subcategory, t.qty, t.orders, Number(t.revenue.toFixed(2))]),
    };
    const revCatSheet: Sheet = {
      name: "RevenueByCategory",
      headers: [tt("admin.prodrep.th.category", "Category"), `${tt("admin.prodrep.kpi.revenue", "Revenue")} (${currency})`],
      rows: revenueByCategory.map(r => [r.category, Number(r.revenue.toFixed(2))]),
    };
    const revSubSheet: Sheet = {
      name: "RevenueBySubcategory",
      headers: ["Category/Subcategory", `${tt("admin.prodrep.kpi.revenue", "Revenue")} (${currency})`],
      rows: revenueBySubcategory.map(r => [r.subset, Number(r.revenue.toFixed(2))]),
    };
    const addonsSheet: Sheet = {
      name: "AddonsImpact",
      headers: [
        tt("admin.prodrep.impact.addons.th.addon", "Addon"),
        `${tt("admin.prodrep.impact.units", "Units")} (${tt("admin.prodrep.extras.addons", "Addons")})`,
        `${tt("admin.prodrep.kpi.revenue", "Revenue")} (${currency})`,
      ],
      rows: addonsAgg.map(a => [a.label, a.count, Number(a.revenue.toFixed(2))]),
    };
    const optionsSheet: Sheet = {
      name: "OptionsImpact",
      headers: [
        tt("admin.prodrep.impact.options.th.optionItem", "Option Item"),
        `${tt("admin.prodrep.impact.units", "Units")} (${tt("admin.prodrep.extras.optionItems", "Option items")})`,
        `${tt("admin.prodrep.kpi.revenue", "Revenue")} (${currency})`,
      ],
      rows: optionsAgg.map(a => [a.label, a.count, Number(a.revenue.toFixed(2))]),
    };
    const neverOrderedSheet: Sheet = {
      name: "NeverOrderedItems",
      headers: [
        tt("admin.prodrep.th.item", "Item"),
        tt("admin.prodrep.th.category", "Category"),
        tt("admin.prodrep.th.subcategory", "Subcategory"),
      ],
      rows: neverOrderedItems.map(n => [n.name, n.category, n.subcategory]),
    };
    const neverUsedAddonsSheet: Sheet = {
      name: "NeverUsedAddons",
      headers: [tt("admin.prodrep.impact.addons.th.addon", "Addon") + " (catalog)"],
      rows: neverUsedAddons.map(lbl => [lbl]),
    };
    const neverUsedOptionsSheet: Sheet = {
      name: "NeverUsedOptions",
      headers: [tt("admin.prodrep.impact.options.th.optionItem", "Option Item") + " (catalog)"],
      rows: neverUsedOptions.map(lbl => [lbl]),
    };

    const xml = buildExcelXml([
      topGlobalSheet,
      topByCatSheet,
      leastSheet,
      revCatSheet,
      revSubSheet,
      addonsSheet,
      optionsSheet,
      neverOrderedSheet,
      neverUsedAddonsSheet,
      neverUsedOptionsSheet,
    ]);
    downloadExcelXml(`product_report_${fromStr}_to_${toStr}.xls`, xml);
  }

  return (
    <Protected>
      <AdminOnly>
        <ToolGate feature="productReports">
          <main className="container py-4">
            <h1 className="h4 mb-3">{tt("admin.prodrep.title", "Product Report")}</h1>

            {/* Filters */}
            <div className="card border-0 shadow-sm mb-3">
              <div className="card-body">
                <div className="row g-3">
                  <div className="col-12 col-md-3">
                    <label className="form-label fw-semibold">{tt("admin.prodrep.range", "Range")}</label>
                    <select className="form-select" value={preset} onChange={(e) => setPreset(e.target.value as any)}>
                      <option value="today">{tt("admin.prodrep.preset.today", "Today")}</option>
                      <option value="7d">{tt("admin.prodrep.preset.7d", "Last 7 days")}</option>
                      <option value="30d">{tt("admin.prodrep.preset.30d", "Last 30 days")}</option>
                      <option value="thisMonth">{tt("admin.prodrep.preset.thisMonth", "This month")}</option>
                      <option value="custom">{tt("admin.prodrep.preset.custom", "Custom")}</option>
                    </select>
                  </div>
                  <div className="col-6 col-md-3">
                    <label className="form-label fw-semibold">{tt("admin.prodrep.from", "From")}</label>
                    <input type="date" className="form-control" value={fromStr} onChange={(e) => { setFromStr(e.target.value); setPreset("custom"); }} />
                  </div>
                  <div className="col-6 col-md-3">
                    <label className="form-label fw-semibold">{tt("admin.prodrep.to", "To")}</label>
                    <input type="date" className="form-control" value={toStr} onChange={(e) => { setToStr(e.target.value); setPreset("custom"); }} />
                  </div>
                  <div className="col-12 col-md-3 d-flex align-items-end">
                    <div className="d-flex gap-2 w-100">
                      <button className="btn btn-primary flex-fill" onClick={load} disabled={loading}>
                        {loading ? tt("common.loadingDots", "Loading…") : tt("common.refresh", "Refresh")}
                      </button>
                      <button className="btn btn-outline-success" onClick={onExportExcel} disabled={loading || orders.length === 0} title={tt("admin.prodrep.export.hint", "Export Excel with multiple tabs")}>
                        {tt("admin.prodrep.export", "Export to Excel")}
                      </button>
                    </div>
                  </div>
                </div>
                {error && <div className="text-danger small mt-2">{error}</div>}
              </div>
            </div>

            {/* KPIs */}
            <div className="row g-3 mb-3">
              <div className="col-12 col-md-3">
                <div className="card border-0 shadow-sm"><div className="card-body">
                  <div className="text-muted small">{tt("admin.prodrep.kpi.orders", "Orders")}</div>
                  <div className="h4 mb-0">{totalOrders}</div>
                </div></div>
              </div>
              <div className="col-12 col-md-3">
                <div className="card border-0 shadow-sm"><div className="card-body">
                  <div className="text-muted small">{tt("admin.prodrep.kpi.revenue", "Revenue")}</div>
                  <div className="h4 mb-0">{fmtQ(totalRevenue)}</div>
                </div></div>
              </div>
              <div className="col-12 col-md-6"></div>
            </div>

            {/* Top / Least */}
            <div className="row g-3">
              <div className="col-12 col-lg-6">
                <div className="card border-0 shadow-sm h-100">
                  <div className="card-header fw-semibold">{tt("admin.prodrep.table.topGlobal.title", "Top 10 — Best Sellers (Global)")}</div>
                  <div className="card-body p-0">
                    <table className="table mb-0">
                      <thead><tr>
                        <th>{tt("admin.prodrep.th.item", "Item")}</th>
                        <th>{tt("admin.prodrep.th.category", "Category")}</th>
                        <th>{tt("admin.prodrep.th.subcategory", "Subcategory")}</th>
                        <th className="text-end">{tt("admin.prodrep.th.qty", "Qty")}</th>
                        <th className="text-end">{tt("admin.prodrep.th.orders", "Orders")}</th>
                        <th className="text-end">{tt("admin.prodrep.th.revenue", "Revenue")}</th>
                      </tr></thead>
                      <tbody>
                        {topGlobal.length === 0 && <tr><td colSpan={6} className="text-center text-muted">{tt("admin.prodrep.nodata", "No data")}</td></tr>}
                        {topGlobal.map((r) => (
                          <tr key={r.id}>
                            <td>{r.name}</td>
                            <td>{r.category}</td>
                            <td>{r.subcategory}</td>
                            <td className="text-end">{r.qty}</td>
                            <td className="text-end">{r.orders}</td>
                            <td className="text-end">{fmtQ(r.revenue)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="col-12 col-lg-6">
                <div className="card border-0 shadow-sm h-100">
                  <div className="card-header fw-semibold">{tt("admin.prodrep.table.least.title", "Top 10 — Least Sellers")}</div>
                  <div className="card-body p-0">
                    <table className="table mb-0">
                      <thead><tr>
                        <th>{tt("admin.prodrep.th.item", "Item")}</th>
                        <th>{tt("admin.prodrep.th.category", "Category")}</th>
                        <th>{tt("admin.prodrep.th.subcategory", "Subcategory")}</th>
                        <th className="text-end">{tt("admin.prodrep.th.qty", "Qty")}</th>
                        <th className="text-end">{tt("admin.prodrep.th.orders", "Orders")}</th>
                        <th className="text-end">{tt("admin.prodrep.th.revenue", "Revenue")}</th>
                      </tr></thead>
                      <tbody>
                        {least.length === 0 && <tr><td colSpan={6} className="text-center text-muted">{tt("admin.prodrep.nodata", "No data")}</td></tr>}
                        {least.map((r) => (
                          <tr key={r.id}>
                            <td>{r.name}</td>
                            <td>{r.category}</td>
                            <td>{r.subcategory}</td>
                            <td className="text-end">{r.qty}</td>
                            <td className="text-end">{r.orders}</td>
                            <td className="text-end">{fmtQ(r.revenue)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>

            {/* Top by Category */}
            <div className="card border-0 shadow-sm mt-3">
              <div className="card-header fw-semibold">{tt("admin.prodrep.table.byCat.title", "Top 10 by Category")}</div>
              <div className="card-body p-0">
                <div className="table-responsive">
                  <table className="table mb-0">
                    <thead><tr>
                      <th>{tt("admin.prodrep.th.category", "Category")}</th>
                      <th>{tt("admin.prodrep.th.item", "Item")}</th>
                      <th className="text-end">{tt("admin.prodrep.th.qty", "Qty")}</th>
                      <th className="text-end">{tt("admin.prodrep.th.orders", "Orders")}</th>
                      <th className="text-end">{tt("admin.prodrep.th.revenue", "Revenue")}</th>
                    </tr></thead>
                    <tbody>
                      {topByCategory.length === 0 && <tr><td colSpan={5} className="text-center text-muted">{tt("admin.prodrep.nodata", "No data")}</td></tr>}
                      {topByCategory.flatMap((grp) =>
                        grp.items.map((it) => (
                          <tr key={`${grp.category}-${it.id}`}>
                            <td>{grp.category}</td>
                            <td>{it.name}</td>
                            <td className="text-end">{it.qty}</td>
                            <td className="text-end">{it.orders}</td>
                            <td className="text-end">{fmtQ(it.revenue)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Charts */}
            <div className="row g-3 mt-3">
              <div className="col-12 col-lg-4">
                <PieChart rows={pieByCategory} title={tt("admin.prodrep.pie.byCategory", "Revenue by Category (Pie)")} formatValue={fmtQ} />
              </div>
              <div className="col-12 col-lg-4">
                <PieChart rows={pieBySubcategory} title={tt("admin.prodrep.pie.bySubcategory", "Revenue by Subcategory (Pie)")} formatValue={fmtQ} />
              </div>
              <div className="col-12 col-lg-4">
                <PieChart rows={pieExtras} title={tt("admin.prodrep.pie.extras", "Extras Revenue (Pie: Addons vs Option items)")} formatValue={fmtQ} />
              </div>
            </div>

            {/* Impact tables */}
            <div className="row g-3 mt-3">
              <div className="col-12 col-lg-6">
                <div className="card border-0 shadow-sm h-100">
                  <div className="card-header fw-semibold">{tt("admin.prodrep.impact.addons.title", "Addons Impact (Top)")}</div>
                  <div className="card-body p-0">
                    <table className="table mb-0">
                      <thead><tr>
                        <th>{tt("admin.prodrep.impact.addons.th.addon", "Addon")}</th>
                        <th className="text-end">{tt("admin.prodrep.impact.units", "Units")}</th>
                        <th className="text-end">{tt("admin.prodrep.th.revenue", "Revenue")}</th>
                      </tr></thead>
                      <tbody>
                        {addonsAgg.length === 0 && <tr><td colSpan={3} className="text-center text-muted">{tt("admin.prodrep.nodata", "No data")}</td></tr>}
                        {addonsAgg.map((a) => (
                          <tr key={a.label}>
                            <td>{a.label}</td>
                            <td className="text-end">{a.count}</td>
                            <td className="text-end">{fmtQ(a.revenue)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="col-12 col-lg-6">
                <div className="card border-0 shadow-sm h-100">
                  <div className="card-header fw-semibold">{tt("admin.prodrep.impact.options.title", "Option-Groups Impact (Top)")}</div>
                  <div className="card-body p-0">
                    <table className="table mb-0">
                      <thead><tr>
                        <th>{tt("admin.prodrep.impact.options.th.optionItem", "Option Item")}</th>
                        <th className="text-end">{tt("admin.prodrep.impact.units", "Units")}</th>
                        <th className="text-end">{tt("admin.prodrep.th.revenue", "Revenue")}</th>
                      </tr></thead>
                      <tbody>
                        {optionsAgg.length === 0 && <tr><td colSpan={3} className="text-center text-muted">{tt("admin.prodrep.nodata", "No data")}</td></tr>}
                        {optionsAgg.map((a) => (
                          <tr key={a.label}>
                            <td>{a.label}</td>
                            <td className="text-end">{a.count}</td>
                            <td className="text-end">{fmtQ(a.revenue)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>

            {/* Never ordered / never used */}
            <div className="row g-3 mt-3">
              <div className="col-12">
                <div className="card border-0 shadow-sm">
                  <div className="card-header fw-semibold">{tt("admin.prodrep.neverOrdered.title", "Menu Items — Never Ordered (in selected range)")}</div>
                  <div className="card-body p-0">
                    <div className="table-responsive">
                      <table className="table mb-0">
                        <thead><tr>
                          <th>{tt("admin.prodrep.th.item", "Item")}</th>
                          <th>{tt("admin.prodrep.th.category", "Category")}</th>
                          <th>{tt("admin.prodrep.th.subcategory", "Subcategory")}</th>
                        </tr></thead>
                        <tbody>
                          {neverOrderedItems.length === 0 && <tr><td colSpan={3} className="text-center text-muted">{tt("admin.prodrep.nodata", "No data")}</td></tr>}
                          {neverOrderedItems.map(mi => (
                            <tr key={mi.id}>
                              <td>{mi.name}</td>
                              <td>{mi.category}</td>
                              <td>{mi.subcategory}</td>
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
                  <div className="card-header fw-semibold">{tt("admin.prodrep.catalog.neverUsedAddons.title", "Catalog — Never Used Addons")}</div>
                  <div className="card-body p-0">
                    <table className="table mb-0">
                      <thead><tr><th>{tt("admin.prodrep.impact.addons.th.addon", "Addon")} (name)</th></tr></thead>
                      <tbody>
                        {neverUsedAddons.length === 0 && <tr><td className="text-center text-muted">{tt("admin.prodrep.nodata", "No data")}</td></tr>}
                        {neverUsedAddons.map((lbl) => (<tr key={lbl}><td>{lbl}</td></tr>))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>

              <div className="col-12 col-lg-6">
                <div className="card border-0 shadow-sm h-100">
                  <div className="card-header fw-semibold">{tt("admin.prodrep.catalog.neverUsedOptions.title", "Catalog — Never Used Option Items")}</div>
                  <div className="card-body p-0">
                    <table className="table mb-0">
                      <thead><tr><th>{tt("admin.prodrep.impact.options.th.optionItem", "Option Item")}</th></tr></thead>
                      <tbody>
                        {neverUsedOptions.length === 0 && <tr><td className="text-center text-muted">{tt("admin.prodrep.nodata", "No data")}</td></tr>}
                        {neverUsedOptions.map((lbl) => (<tr key={lbl}><td>{lbl}</td></tr>))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </main>
        </ToolGate>
      </AdminOnly>
    </Protected>
  );
}
