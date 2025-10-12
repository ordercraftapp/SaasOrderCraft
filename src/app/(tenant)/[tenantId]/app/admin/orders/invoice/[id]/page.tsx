// src/app/(tenant)/[tenantId]/app/admin/orders/invoice/[id]/page.tsx
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';

import Protected from "@/app/(tenant)/[tenantId]/components/Protected";
import AdminOnly from "@/app/(tenant)/[tenantId]/components/AdminOnly";
import ToolGate from "@/components/ToolGate";

// ✅ Bootstrap Firebase (cliente) centralizado
import '@/lib/firebase/client';

// ✅ Tenant + Firestore helpers
import { useTenantId } from '@/lib/tenant/context';
import { tCol, tDoc } from '@/lib/db';

// 🔤 i18n / settings
import { t as translate } from '@/lib/i18n/t';
import { useTenantSettings } from '@/lib/settings/hooks';

/* ============ Auth (mínimo) ============ */
async function getAuthMod() {
  return await import('firebase/auth');
}
async function getIdTokenSafe(forceRefresh = false): Promise<string | null> {
  try {
    const { getAuth } = await getAuthMod();
    const auth = getAuth();
    const user = auth.currentUser;
    if (!user) return null;
    return await user.getIdToken(forceRefresh);
  } catch {
    return null;
  }
}
/** ✅ Llama a APIs TENANT-scoped: /app/api/... (no /api root) */
async function apiFetch(path: string, init?: RequestInit) {
  let token = await getIdTokenSafe(false);
  let headers: HeadersInit = { ...(init?.headers || {}) };
  if (token) (headers as any)['Authorization'] = `Bearer ${token}`;
  let res = await fetch(path, { ...init, headers });
  if (res.status === 401) {
    token = await getIdTokenSafe(true);
    headers = { ...(init?.headers || {}) };
    if (token) (headers as any)['Authorization'] = `Bearer ${token}`;
    res = await fetch(path, { ...init, headers });
  }
  return res;
}

/* ===== Firestore (solo para leer info de cliente) ===== */
async function getFirestoreMod() {
  return await import('firebase/firestore');
}

/* ============ Tipos & utils (idénticos al receipt) ============ */
type StatusSnake =
  | 'cart' | 'placed' | 'kitchen_in_progress' | 'kitchen_done'
  | 'ready_to_close' | 'assigned_to_courier' | 'on_the_way'
  | 'delivered' | 'closed' | 'cancelled';

type OptionItem = { id?: string; name?: string; price?: number; priceCents?: number; priceDelta?: number; priceDeltaCents?: number; priceExtra?: number; priceExtraCents?: number };
type OrderItemLine = {
  menuItemName: string;
  quantity: number;
  optionGroups?: Array<{ groupId?: string; groupName?: string; type?: 'single'|'multiple'; items: OptionItem[] }>;
  options?: Array<{ groupName: string; selected: OptionItem[] }>;
  addons?: Array<any>;
  extras?: Array<any>;
  modifiers?: Array<any>;
  unitPriceCents?: number;
  unitPrice?: number;
  priceCents?: number;
  price?: number;
  basePriceCents?: number;
  basePrice?: number;
  menuItemPriceCents?: number;
  menuItemPrice?: number;
  totalCents?: number;
  menuItem?: { price?: number; priceCents?: number };
};
type Amounts = {
  subtotal?: number;
  serviceFee?: number;
  discount?: number;
  tax?: number;
  tip?: number;
  total?: number;
};

type TaxSnapshot = {
  currency: string;
  totals: { subTotalCents: number; taxCents: number; grandTotalCents: number };
  summaryByRate: Array<{ code?: string; rateBps: number; taxCents: number }>;
  surcharges?: Array<{ baseCents: number; taxCents: number }>;
  customer?: { taxId?: string; name?: string };
} | null | undefined;

type OrderDoc = {
  id: string;
  orderNumber?: string;
  type?: 'dine_in' | 'delivery';
  status: StatusSnake;
  items?: OrderItemLine[];
  lines?: OrderItemLine[];
  amounts?: Amounts;
  totals?: {
    totalCents?: number; subtotalCents?: number; taxCents?: number; serviceFeeCents?: number; discountCents?: number;
    subtotal?: number; deliveryFee?: number; tip?: number; currency?: string; discount?: number;
  };
  orderTotal?: number;

  tableNumber?: string | null;
  deliveryAddress?: string | null;
  notes?: string | null;
  createdAt?: any;

  orderInfo?: {
    type?: 'dine-in' | 'delivery' | 'pickup';
    table?: string;
    notes?: string;
    address?: string;
    phone?: string;
    customerName?: string;
    addressLabel?: 'home' | 'office';
    addressInfo?: { line1?: string; city?: string; country?: string; zip?: string; notes?: string };
    addressNotes?: string;
    deliveryOption?: { title: string; description?: string; price: number } | null;
  } | null;

  createdBy?: { uid?: string; email?: string | null } | null;
  userEmail?: string | null;
  userEmail_lower?: string | null;

  taxSnapshot?: TaxSnapshot;

  invoiceNumber?: string;
  invoiceDate?: any | null;
};

const toNum = (x: any) => { const n = Number(x); return Number.isFinite(n) ? n : undefined; };
const centsToQ = (c?: number) => (Number.isFinite(c) ? Number(c) / 100 : 0);
function fmtCurrency(n?: number, currency = 'GTQ') {
  if (typeof n !== 'number') return '—';
  try { return new Intl.NumberFormat('es-GT', { style: 'currency', currency }).format(n); }
  catch { return n.toFixed(2); }
}
function toDateOrNullStrict(x: any): Date | null {
  if (!x) return null;
  if (typeof x?.toDate === 'function') {
    const d = x.toDate();
    return d instanceof Date && !isNaN(d.getTime()) ? d : null;
  }
  if (typeof x === 'object') {
    const seconds = x.seconds ?? x._seconds ?? x.$seconds;
    const nanos   = x.nanoseconds ?? x._nanoseconds ?? x.nanos ?? 0;
    if (Number.isFinite(seconds)) {
      const ms = Number(seconds) * 1000 + Math.floor(Number(nanos) / 1e6);
      const d = new Date(ms);
      return !isNaN(d.getTime()) ? d : null;
    }
    const iso = x.$date ?? x.iso ?? x.date;
    if (typeof iso === 'string') {
      const d = new Date(iso);
      return !isNaN(d.getTime()) ? d : null;
    }
  }
  if (typeof x === 'string' || typeof x === 'number') {
    const d = new Date(x);
    return !isNaN(d.getTime()) ? d : null;
  }
  return null;
}
function getLineQty(l: any) { return Number(l?.quantity ?? l?.qty ?? 1) || 1; }
function getLineName(l: any) { return String(l?.menuItemName ?? l?.name ?? l?.menuItem?.name ?? 'Ítem'); }
function extractDeltaQ(x: any): number {
  const a = toNum(x?.priceDelta); if (a !== undefined) return a;
  const b = toNum(x?.priceExtra); if (b !== undefined) return b;
  const ac = toNum(x?.priceDeltaCents); if (ac !== undefined) return ac / 100;
  const bc = toNum(x?.priceExtraCents); if (bc !== undefined) return bc / 100;
  const p = toNum(x?.price); if (p !== undefined) return p;
  const pc = toNum(x?.priceCents); if (pc !== undefined) return pc / 100;
  return 0;
}
function perUnitAddonsQ(l: any): number {
  let sum = 0;
  if (Array.isArray(l?.optionGroups)) for (const g of l.optionGroups) for (const it of (g?.items||[])) sum += extractDeltaQ(it);
  if (Array.isArray(l?.options)) for (const g of l.options) for (const s of (g?.selected||[])) sum += extractDeltaQ(s);
  for (const key of ['addons','extras','modifiers'] as const) {
    const arr = (l as any)[key];
    if (Array.isArray(arr)) for (const x of arr) { if (typeof x === 'string') continue; sum += extractDeltaQ(x); }
  }
  return sum;
}
function baseUnitPriceQ(l: any): number {
  const baseCents = toNum(l?.basePriceCents) ?? toNum(l?.menuItemPriceCents);
  if (baseCents !== undefined) return baseCents / 100;
  const base = toNum(l?.basePrice) ?? toNum(l?.menuItemPrice);
  if (base !== undefined) return base;
  const miCents = toNum(l?.menuItem?.priceCents);
  if (miCents !== undefined) return miCents / 100;
  const mi = toNum(l?.menuItem?.price);
  if (mi !== undefined) return mi;
  const upc = toNum(l?.unitPriceCents); if (upc !== undefined) return upc / 100;
  const up = toNum(l?.unitPrice); if (up !== undefined) return up;
  const qty = getLineQty(l);
  const totC = toNum(l?.totalCents);
  if (totC !== undefined && qty > 0) {
    const per = totC / 100 / qty;
    const addons = perUnitAddonsQ(l);
    const derived = per - addons;
    return derived > 0 ? derived : 0;
  }
  const pc = toNum(l?.priceCents); if (pc !== undefined) return pc / 100;
  const p = toNum(l?.price); if (p !== undefined) return p;
  return 0;
}
function lineTotalQ(l: any): number {
  const qty = getLineQty(l);
  const base = baseUnitPriceQ(l);
  const deltas = perUnitAddonsQ(l);
  const totC = toNum(l?.totalCents);
  if (totC !== undefined) return totC / 100;
  return (base + deltas) * qty;
}
function preferredLines(o: OrderDoc): OrderItemLine[] {
  return (Array.isArray(o.items) && o.items.length ? o.items! : (Array.isArray(o.lines) ? o.lines! : [])) as OrderItemLine[];
}
function computeOrderTotalsQ(o: OrderDoc) {
  if (o?.totals && (o.totals.subtotal !== undefined || (o.totals as any).deliveryFee !== undefined || (o.totals as any).tip !== undefined)) {
    const subtotal = Number(o.totals.subtotal || 0);
    const deliveryFee = Number((o.totals as any).deliveryFee || 0);
    const tip = Number((o.totals as any).tip || 0);
    const discount = Number((o.totals as any).discount || 0);
    const total = Number.isFinite(o.orderTotal) ? Number(o.orderTotal) : (subtotal + deliveryFee + tip - discount);
    return { subtotal, tax: 0, serviceFee: 0, discount, tip, deliveryFee, total };
  }
  if (o?.amounts && Number.isFinite(o.amounts.total)) {
    return {
      subtotal: Number(o.amounts.subtotal || 0),
      tax: Number(o.amounts.tax || 0),
      serviceFee: Number(o.amounts.serviceFee || 0),
      discount: Number(o.amounts.discount || 0),
      tip: Number(o.amounts.tip || 0),
      deliveryFee: 0,
      total: Number(o.amounts.total || 0),
    };
  }
  if (o?.totals && Number.isFinite(o.totals.totalCents)) {
    return {
      subtotal: centsToQ(o.totals.subtotalCents),
      tax: centsToQ(o.totals.taxCents),
      serviceFee: centsToQ(o.totals.serviceFeeCents),
      discount: centsToQ(o.totals.discountCents),
      tip: Number(o.amounts?.tip || 0),
      deliveryFee: 0,
      total: centsToQ(o.totals.totalCents) + Number(o.amounts?.tip || 0),
    };
  }
  const lines = preferredLines(o);
  const subtotal = lines.reduce((acc, l) => acc + lineTotalQ(l), 0);
  const tip = Number(o.amounts?.tip || 0);
  return { subtotal, tax: 0, serviceFee: 0, discount: 0, deliveryFee: 0, total: subtotal + tip };
}
function safeLineTotalsQ(l: any) {
  const qty = getLineQty(l);
  let baseUnit = baseUnitPriceQ(l);
  const addonsUnit = perUnitAddonsQ(l);
  if (baseUnit === 0) {
    const totC = toNum(l?.totalCents);
    if (totC !== undefined && qty > 0) {
      const per = totC / 100 / qty;
      const derived = per - addonsUnit;
      if (derived > 0) baseUnit = derived;
    }
  }
  const lineTotal = (baseUnit + addonsUnit) * qty;
  return { baseUnit, addonsUnit, lineTotal, qty };
}
function fullAddressFrom(order: OrderDoc | null | undefined): string | null {
  const ai = order?.orderInfo?.addressInfo;
  if (ai && (ai.line1 || ai.city || ai.country || ai.zip)) {
    const parts: string[] = [];
    if (ai.line1) parts.push(String(ai.line1));
    if (ai.city) parts.push(String(ai.city));
    if (ai.country) parts.push(String(ai.country));
    let full = parts.join(', ');
    if (ai.zip) full = `${full} ${ai.zip}`;
    return full || null;
  }
  return order?.orderInfo?.address || order?.deliveryAddress || null;
}

/** ✅ Llama APIs tenant-scoped dentro de /app/api/... */
async function fetchOrder(id: string): Promise<OrderDoc | null> {
  let res = await apiFetch(`/app/api/orders/${id}`);
  if (res.ok) {
    const data = await res.json();
    return (data?.order || data) as OrderDoc;
  }
  res = await apiFetch(`/app/api/orders?id=${encodeURIComponent(id)}&limit=1`);
  if (res.ok) {
    const data = await res.json();
    const list = (data?.items ?? data?.orders ?? []) as OrderDoc[];
    return list?.[0] ?? null;
  }
  return null;
}

/** ✅ Lee billing del cliente TENANT-scoped (customers) */
async function fetchCustomerBillingForOrder(tenantId: string, order: OrderDoc) {
  const { getFirestore, getDoc, query, where, limit, getDocs } = await getFirestoreMod();
  const db = getFirestore();

  const uid = order?.createdBy?.uid;
  if (uid) {
    const snap = await getDoc(tDoc('customers', tenantId, uid) as any);
    if (snap.exists()) {
      const d: any = snap.data() || {};
      const b = d?.billing || {};
      return { name: b?.name as (string | undefined), taxId: b?.taxId as (string | undefined) };
    }
  }
  const email = order?.userEmail || order?.userEmail_lower || order?.createdBy?.email || null;
  if (email) {
    const q = query(tCol('customers', tenantId) as any, where('email', '==', String(email)), limit(1));
    const qs = await getDocs(q);
    const first = qs.docs[0];
    if (first?.exists()) {
      const d: any = first.data() || {};
      const b = d?.billing || {};
      return { name: b?.name as (string | undefined), taxId: b?.taxId as (string | undefined) };
    }
  }
  return { name: undefined, taxId: undefined };
}

/* ============ Página (solo lectura; NO genera factura) ============ */
function PrintInvoicePage_Inner() {
  const { id } = useParams<{ id: string }>();
  const tenantId = useTenantId() || '';

  const [order, setOrder] = useState<OrderDoc | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [billingName, setBillingName] = useState<string | undefined>(undefined);
  const [billingTaxId, setBillingTaxId] = useState<string | undefined>(undefined);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const o = await fetchOrder(String(id));
        if (!alive) return;
        if (!o) { setError('Order not found'); return; }

        // 🚫 NO creamos número de factura; solo mostramos los guardados
        setOrder(o);

        // billing (no bloquea) — TENANT scoped
        fetchCustomerBillingForOrder(tenantId, o)
          .then((b) => { if (!alive) return; setBillingName(b?.name); setBillingTaxId(b?.taxId); })
          .catch(() => {});
        // imprimir
        setTimeout(() => { try { window.print(); } catch {} }, 150);
      } catch (e: any) {
        if (!alive) return;
        setError(e?.message || 'The order could not be loaded.');
      }
    })();
    return () => { alive = false; };
  }, [id, tenantId]);

  // i18n (opcional, dejamos como en tu original si más adelante quieres traducir etiquetas)
  const { settings } = useTenantSettings();
  const lang = React.useMemo(() => {
    try { if (typeof window !== 'undefined') { const ls = localStorage.getItem('tenant.language'); if (ls) return ls; } } catch {}
    return (settings as any)?.language;
  }, [settings]);
  const tt = (key: string, fb: string, vars?: Record<string, unknown>) => {
    const s = translate(lang, key, vars);
    return s === key ? fb : s;
  };

  const type = useMemo(() => {
    const t = order?.orderInfo?.type?.toLowerCase?.();
    if (t === 'delivery') return 'delivery';
    return order?.type || (order?.orderInfo?.address || order?.deliveryAddress ? 'delivery' : 'dine_in');
  }, [order]);

  const lines = useMemo(() => (order ? preferredLines(order) : []), [order]);
  const totals = useMemo(() => (order ? computeOrderTotalsQ(order) : null), [order]);

  const address = order?.orderInfo?.address || order?.deliveryAddress || null; // solo para visual
  const phone   = order?.orderInfo?.phone || null;
  const table   = order?.orderInfo?.table || order?.tableNumber || null;
  const notes   = order?.orderInfo?.notes || order?.notes || null;

  const fullAddress  = fullAddressFrom(order);

  const deliveryFeeShown = useMemo(() => {
    if (!order) return 0;
    const dfFromTotals = Number(((order as any)?.totals?.deliveryFee) ?? 0);
    if (Number.isFinite(dfFromTotals) && dfFromTotals) return dfFromTotals;
    return Number(order.orderInfo?.deliveryOption?.price || 0);
  }, [order]);

  const grandTotalShown = useMemo(() => {
    if (!order || !totals) return 0;
    return Number.isFinite(order.orderTotal) ? Number(order.orderTotal) : Number(totals.total || 0);
  }, [order, totals]);

  const promoLabel = useMemo(() => {
    const promos = (order as any)?.appliedPromotions;
    if (Array.isArray(promos) && promos.length) {
      const names = promos.map((p: any) => p?.code || p?.name).filter(Boolean);
      if (names.length) return names.join(', ');
    }
    return (order as any)?.promotionCode || null;
  }, [order]);

  const currency = useMemo(
    () => (order as any)?.currency || order?.totals?.currency || 'GTQ',
    [order]
  );

  const invoiceDateStr = useMemo(() => {
    const d = toDateOrNullStrict(order?.invoiceDate);
    return d ? d.toLocaleString() : null;
  }, [order?.invoiceDate]);

  return (
    <>
      <style>{`
        * { box-sizing: border-box; }
        @media print { .noprint { display: none !important; } }
        .wrap { max-width: 360px; margin: 0 auto; padding: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Courier New", monospace; }
        h1 { font-size: 14px; margin: 0 0 6px; text-transform: uppercase; }
        .muted { color: #666; font-size: 11px; }
        .row { display: flex; justify-content: space-between; font-size: 12px; }
        .hr { border-top: 1px dashed #999; margin: 8px 0; }
        .item { margin: 6px 0; }
        .item .name { font-weight: 600; }
        .addon { margin-left: 10px; color: #555; font-size: 11px; }
        .tot { font-weight: 700; }
        .center { text-align: center; }
        .btn { display: inline-block; border: 1px solid #ccc; padding: 6px 10px; border-radius: 6px; background: #f7f7f7; cursor: pointer; }
      `}</style>

      <div className="wrap">
        <div className="noprint" style={{ marginBottom: 8 }}>
          <button className="btn" onClick={() => window.print()}>{tt('admin.invoice.print', 'Print')}</button>
          <button className="btn" onClick={() => window.close?.()} style={{ marginLeft: 8 }}>{tt('admin.invoice.close', 'Close')}</button>
        </div>

        {!order && !error && <div className="muted">{tt('admin.invoice.loading', 'Loading...')}</div>}
        {error && <div className="muted">Error: {error}</div>}

        {order && totals && (
          <>
            <h1>{type === 'delivery' ? 'Delivery' : 'Dine-in'}</h1>

            {/* Solo número de orden; sin otras fechas */}
            <div className="muted">#{order.orderNumber || order.id}</div>
            {table ? <div className="muted">Table: {table}</div> : null}

            {/* Invoice info: solo lo guardado en la orden */}
            {order.invoiceNumber ? <div className="muted">Invoice: {order.invoiceNumber}</div> : null}
            {invoiceDateStr ? <div className="muted">Invoice date: {invoiceDateStr}</div> : null}

            {/* Datos de cliente para factura */}
            {(billingName || billingTaxId) && <div className="hr"></div>}
            {( (order as any)?.customer?.name ?? (order as any)?.customer?.names ?? billingName )
              ? <div className="muted">Customer: {(order as any)?.customer?.name ?? (order as any)?.customer?.names ?? billingName}</div>
              : null}
            {( (order as any)?.customer?.taxId ?? billingTaxId )
              ? <div className="muted">Tax ID: {(order as any)?.customer?.taxId ?? billingTaxId}</div>
              : null}

            {fullAddress ? <div className="muted">Delivery: {fullAddress}</div> : null}
            {phone ? <div className="muted">Phone: {phone}</div> : null}

            {notes ? <div className="muted">Note: {notes}</div> : null}

            <div className="hr"></div>

            {lines.map((l, idx) => {
              const { baseUnit, addonsUnit, lineTotal, qty } = safeLineTotalsQ(l);
              const name = getLineName(l);

              const groupsHtml: React.ReactNode[] = [];

              if (Array.isArray(l?.optionGroups)) {
                for (const g of l.optionGroups) {
                  const its = Array.isArray(g?.items) ? g.items : [];
                  if (!its.length) continue;
                  const rows = its.map((it: any, i:number) => {
                    const nm = it?.name ?? '';
                    const pr = extractDeltaQ(it);
                    return <span key={i}>{nm}{pr ? ` (${fmtCurrency(pr, currency)})` : ''}{i < its.length - 1 ? ', ' : ''}</span>;
                  });
                  groupsHtml.push(<div className="addon" key={`g${groupsHtml.length}`}>• <b>{g?.groupName ?? 'Options'}:</b> {rows}</div>);
                }
              }

              if (Array.isArray(l?.options)) {
                for (const g of l.options) {
                  const sels = Array.isArray(g?.selected) ? g.selected : [];
                  if (!sels.length) continue;
                  const rows = sels.map((s: any, i:number) => {
                    const nm = s?.name ?? '';
                    const pr = extractDeltaQ(s);
                    return <span key={i}>{nm}{pr ? ` (${fmtCurrency(pr, currency)})` : ''}{i < sels.length - 1 ? ', ' : ''}</span>;
                  });
                  groupsHtml.push(<div className="addon" key={`g${groupsHtml.length}`}>• <b>{g?.groupName ?? 'Options'}:</b> {rows}</div>);
                }
              }

              for (const key of ['addons', 'extras', 'modifiers'] as const) {
                const arr = (l as any)[key];
                if (Array.isArray(arr) && arr.length) {
                  const rows = arr.map((x: any, i:number) => {
                    if (typeof x === 'string') return <span key={i}>{x}{i < arr.length - 1 ? ', ' : ''}</span>;
                    const nm = x?.name ?? '';
                    const pr = extractDeltaQ(x);
                    return <span key={i}>{nm}{pr ? ` (${fmtCurrency(pr, currency)})` : ''}{i < arr.length - 1 ? ', ' : ''}</span>;
                  });
                  groupsHtml.push(<div className="addon" key={`b${groupsHtml.length}`}>• <b>{key}:</b> {rows}</div>);
                }
              }

              return (
                <div className="item" key={idx}>
                  <div className="row">
                    <div className="name">{qty} × {name}</div>
                    <div>{fmtCurrency(baseUnit, currency)}</div>
                  </div>
                  {groupsHtml}
                  {lineTotal > 0 && (
                    <div className="row">
                      <div className="muted">Subtotal line</div>
                      <div className="muted">{fmtCurrency(lineTotal, currency)}</div>
                    </div>
                  )}
                </div>
              );
            })}

            <div className="hr"></div>
            <div className="row"><div>Subtotal</div><div>{fmtCurrency(totals.subtotal, currency)}</div></div>

            {type === 'delivery' && (
              <div className="row">
                <div>Delivery{ (order as any)?.orderInfo?.deliveryOption?.title ? ` — ${(order as any).orderInfo.deliveryOption.title}` : '' }</div>
                <div>{fmtCurrency(deliveryFeeShown, currency)}</div>
              </div>
            )}

            {Number(totals.discount || 0) > 0 && (
              <div className="row">
                <div>Discount{promoLabel ? ` (${promoLabel})` : ''}</div>
                <div>-{fmtCurrency(totals.discount, currency)}</div>
              </div>
            )}

            {totals.tax ? <div className="row"><div>Taxes</div><div>{fmtCurrency(totals.tax, currency)}</div></div> : null}
            {totals.serviceFee ? <div className="row"><div>Service</div><div>{fmtCurrency(totals.serviceFee, currency)}</div></div> : null}

            {Number(totals.tip || 0) > 0 && <div className="row"><div>Tip</div><div>{fmtCurrency(totals.tip, currency)}</div></div>}

            <div className="row tot"><div>Gran total</div><div>{fmtCurrency(grandTotalShown, currency)}</div></div>

            {(() => {
              const s = (order as any)?.taxSnapshot as TaxSnapshot;
              return s && (
                <>
                  <div className="hr"></div>
                  <div className="muted">Tax breakdown</div>
                  <div className="row">
                    <div>Subtotal</div>
                    <div>{(s.totals.subTotalCents/100).toFixed(2)} {s.currency}</div>
                  </div>
                  {Array.isArray(s.summaryByRate) && s.summaryByRate.map((r, i) => (
                    <div className="row" key={r?.code || i}>
                      <div>Tax {(r.rateBps/100).toFixed(2)}%</div>
                      <div>{(r.taxCents/100).toFixed(2)} {s.currency}</div>
                    </div>
                  ))}
                  {Array.isArray(s.surcharges) && s.surcharges.map((x, i) => (
                    <div className="row" key={i}>
                      <div>Service charge</div>
                      <div>
                        {(x.baseCents/100).toFixed(2)} {s.currency}
                        {x.taxCents>0 && ` (tax ${(x.taxCents/100).toFixed(2)} ${s.currency})`}
                      </div>
                    </div>
                  ))}
                  <div className="row tot">
                    <div>Total</div>
                    <div>{(s.totals.grandTotalCents/100).toFixed(2)} {s.currency}</div>
                  </div>
                  {s.customer?.taxId && <div className="muted">Customer Tax ID: {s.customer.taxId}</div>}
                </>
              );
            })()}

            <div className="hr"></div>
            <div className="center muted">Thank you for your purchase!</div>
          </>
        )}
      </div>
    </>
  );
}

export default function PrintInvoicePage() {
  return (
    <Protected>
      <AdminOnly>
        <ToolGate feature="orders">
          <PrintInvoicePage_Inner />
        </ToolGate>
      </AdminOnly>
    </Protected>
  );
}
