// src/app/(tenant)/[tenant]/app/admin/cashier/page.tsx
'use client';

import { OnlyCashier } from "@/app/(tenant)/[tenantId]/components/Only";

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { getActiveTaxProfile } from '@/lib/tax/profile'; // ✅ NUEVO
import { useFmtQ } from '@/lib/settings/money'; // ✅ usar formateador global (sin fmtCents)

// 🔤 i18n
import { t as translate } from "@/lib/i18n/t";
import { useTenantSettings } from "@/lib/settings/hooks";

/* 🔐 Plan gate + tenant context */
import ToolGate from "@/components/ToolGate";
import { useTenantId } from "@/lib/tenant/context";

/* ===================================================
   Firebase (client) — igual que en OPS, sin tocar nada
=================================================== */
function getFirebaseClientConfig() {
  return {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  };
}
async function ensureFirebaseApp() {
  const app = await import('firebase/app');
  if (!app.getApps().length) {
    const cfg = getFirebaseClientConfig();
    if (cfg.apiKey && cfg.authDomain && cfg.projectId && cfg.appId) {
      app.initializeApp(cfg);
    } else {
      console.warn('[Firebase] Missing NEXT_PUBLIC_* variables; Auth will not be able to initialize.');
    }
  }
}
async function getAuthMod() {
  await ensureFirebaseApp();
  const mod = await import('firebase/auth');
  return mod;
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
async function getIdTokenResultSafe(): Promise<{ token: string; claims: any } | null> {
  try {
    const { getAuth, getIdTokenResult } = await getAuthMod();
    const auth = getAuth();
    const user = auth.currentUser;
    if (!user) return null;
    const res = await getIdTokenResult(user, false);
    return { token: res.token, claims: res.claims };
  } catch {
    return null;
  }
}
function useAuthState() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<any | null>(null);
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { onAuthStateChanged, getAuth } = await getAuthMod();
      const auth = getAuth();
      const unsub = onAuthStateChanged(auth, (u) => {
        if (!mounted) return;
        setUser(u ?? null);
        setAuthReady(true);
      });
      return () => unsub();
    })();
    return () => { mounted = false; };
  }, []);
  return { authReady, user } as const;
}
function useAuthClaims() {
  const { authReady, user } = useAuthState();
  const [claims, setClaims] = useState<any | null>(null);
  useEffect(() => {
    let mounted = true;
    (async () => {
      if (!user) { setClaims(null); return; }
      const res = await getIdTokenResultSafe();
      if (mounted) setClaims(res?.claims ?? null);
    })();
    return () => { mounted = false; };
  }, [user]);
  const flags = useMemo(() => ({
    isAdmin: !!claims?.admin,
    isKitchen: !!claims?.kitchen || !!claims?.admin,
    isCashier: !!claims?.cashier || !!claims?.admin,
    isDelivery: !!claims?.delivery || !!claims?.admin,
    isWaiter: !!claims?.waiter || !!claims?.admin,
  }), [claims]);
  return { authReady, user, claims, ...flags } as const;
}
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

/* ===================================================
   Types & Utils
=================================================== */
type StatusSnake =
  | 'cart'
  | 'placed'
  | 'kitchen_in_progress'
  | 'kitchen_done'
  | 'ready_to_close'
  | 'assigned_to_courier'
  | 'on_the_way'
  | 'delivered'
  | 'closed'
  | 'cancelled';

type OptionItem = { id?: string; name?: string; price?: number; priceCents?: number; priceDelta?: number; priceDeltaCents?: number; priceExtra?: number; priceExtraCents?: number };
type OrderItemLine = {
  menuItemName: string;
  quantity: number;

  // NUEVO: optionGroups desde Checkout (además de legacy options)
  optionGroups?: Array<{ groupId?: string; groupName?: string; type?: 'single' | 'multiple'; items: OptionItem[] }>;

  options?: Array<{ groupName: string; selected: OptionItem[] }>;
  addons?: Array<string | OptionItem>;
  extras?: Array<string | OptionItem>;
  modifiers?: Array<string | OptionItem>;
  unitPriceCents?: number;
  unitPrice?: number;
  priceCents?: number;
  price?: number;
  basePriceCents?: number;
  basePrice?: number;
  menuItemPriceCents?: number;
  menuItemPrice?: number;
  totalCents?: number;

  // opcional por compat
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

// 🆕 Tipo ligero para el snapshot de impuestos (solo lo que usamos en UI)
type TaxSnapshot = {
  currency: string;
  totals: { subTotalCents: number; taxCents: number; grandTotalCents: number };
  summaryByRate: Array<{ code?: string; rateBps: number; taxCents: number }>;
  surcharges?: Array<{ baseCents: number; taxCents: number }>;
  customer?: { taxId?: string };
} | null | undefined;

// 🆕 Cliente (para override de facturación)
type OrderCustomer = {
  name?: string | null;
  taxId?: string | null;
} | null | undefined;

type OrderDoc = {
  id: string;
  orderNumber?: string;
  type?: 'dine_in' | 'delivery';
  status: StatusSnake;
  items?: OrderItemLine[];
  lines?: OrderItemLine[];
  amounts?: Amounts;

  // EXTENSIÓN: totals puede traer breakdown en cents ó en Q (checkout nuevo)
  totals?: {
    totalCents?: number; subtotalCents?: number; taxCents?: number; serviceFeeCents?: number; discountCents?: number;
    subtotal?: number; deliveryFee?: number; tip?: number; currency?: string; discount?: number;
  };

  // EXTENSIÓN: gran total guardado por checkout nuevo
  orderTotal?: number;

  tableNumber?: string | null;
  deliveryAddress?: string | null;
  notes?: string | null;
  createdAt?: any;

  // Además puede venir orderInfo desde Checkout
  orderInfo?: {
    type?: 'dine-in' | 'delivery' | 'pickup';
    table?: string;
    notes?: string;
    address?: string;
    phone?: string;
    customerName?: string;
    // NUEVO: opción de envío (checkout)
    deliveryOption?: { title: string; description?: string; price: number } | null;
  } | null;

  // 🆕 Campos opcionales de pago (AGREGADO para badge PayPal)
  payment?: {
    provider?: string;   // 'paypal' | 'cash' | 'stripe'...
    status?: string;     // 'paid' | 'captured' | 'completed' | ...
    id?: string;
    amount?: number;
    currency?: string;
  } | null;
  payments?: Array<{
    provider?: string;
    status?: string;
    id?: string;
    amount?: number;
    currency?: string;
  }>;

  // 🆕 Snapshot fiscal (agregado por el Checkout nuevo)
  taxSnapshot?: TaxSnapshot;

  // 🆕 Datos de cliente (para override de facturación)
  customer?: OrderCustomer;
};

// 🔤 i18n: claves de estado (Cashier)
function statusKey(s: StatusSnake): string {
  const map: Record<StatusSnake, string> = {
    cart: 'admin.cashier.status.cart',
    placed: 'admin.cashier.status.received',
    kitchen_in_progress: 'admin.cashier.status.inKitchen',
    kitchen_done: 'admin.cashier.status.kitchenReady',
    ready_to_close: 'admin.cashier.status.readyToClose',
    assigned_to_courier: 'admin.cashier.status.assigned',
    on_the_way: 'admin.cashier.status.onTheWay',
    delivered: 'admin.cashier.status.delivered',
    closed: 'admin.cashier.status.closed',
    cancelled: 'admin.cashier.status.cancelled',
  };
  return map[s] || 'admin.cashier.status.unknown';
}

function toDate(x: any): Date {
  if (x?.toDate?.() instanceof Date) return x.toDate();
  const d = new Date(x);
  return isNaN(d.getTime()) ? new Date() : d;
}

const toNum = (x: any) => {
  const n = Number(x);
  return Number.isFinite(n) ? n : undefined;
};
const centsToQ = (c?: number) => (Number.isFinite(c) ? (Number(c) / 100) : 0);

/* ===================================================
   Flujos y helpers de transición (cierre encadenado)
=================================================== */
const FLOW_DINE_IN: StatusSnake[] = ['placed', 'kitchen_in_progress', 'kitchen_done', 'ready_to_close', 'closed'];
const FLOW_DELIVERY: StatusSnake[] = ['placed', 'kitchen_in_progress', 'kitchen_done', 'assigned_to_courier', 'on_the_way', 'delivered', 'closed'];

function flowFor(type: 'dine_in' | 'delivery') {
  return type === 'delivery' ? FLOW_DELIVERY : FLOW_DINE_IN;
}
function nextAllowed(type: 'dine_in' | 'delivery', from: StatusSnake): StatusSnake | null {
  const f = flowFor(type);
  const i = f.indexOf(from);
  return i >= 0 && i < f.length - 1 ? f[i + 1] : null;
}
async function changeStatus(orderId: string, to: StatusSnake) {
  const key = `${orderId}:${to}:${Date.now()}`;
  const res = await apiFetch(`/api/orders/${orderId}/status`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', 'X-Idempotency-Key': key },
    body: JSON.stringify({ nextStatus: to }),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || `Status ${res.status}`);
  }
  return res.json();
}

/* 🆕 Actualiza payment.status a 'closed' en Firestore (scoped) */
async function setPaymentStatusClosed(orderId: string, tenantId: string) {
  await ensureFirebaseApp();
  const { getFirestore, doc, updateDoc } = await import('firebase/firestore');
  const db = getFirestore();
  await updateDoc(doc(db, `tenants/${tenantId}/orders/${orderId}`), { 'payment.status': 'closed', tenantId });
}

async function advanceToClose(order: OrderDoc, onStep?: (s: StatusSnake) => Promise<void>) {
  const type = (order.orderInfo?.type?.toLowerCase?.() === 'delivery')
    ? 'delivery'
    : (order.type || (order.deliveryAddress ? 'delivery' : 'dine_in'));
  let cur = order.status;
  while (cur !== 'closed') {
    const nx = nextAllowed(type, cur);
    if (!nx) break;
    if (onStep) await onStep(nx);
    await changeStatus(order.id, nx);
    cur = nx;
  }
}

/* ===================================================
   Cálculo de totales y líneas (con addons + deltas)
=================================================== */
function getLineQty(l: any) { return Number(l?.quantity ?? l?.qty ?? 1) || 1; }
function getLineName(l: any) { return String(l?.menuItemName ?? l?.name ?? l?.menuItem?.name ?? 'Ítem'); }

/** Precio base c/u del plato (sin addons). Incluye varios fallbacks. */
function baseUnitPriceQ(l: any): number {
  const baseCents = toNum(l?.basePriceCents) ?? toNum(l?.menuItemPriceCents);
  if (baseCents !== undefined) return baseCents / 100;
  const base = toNum(l?.basePrice) ?? toNum(l?.menuItemPrice);
  if (base !== undefined) return base;

  const miCents = toNum(l?.menuItem?.priceCents);
  if (miCents !== undefined) return miCents / 100;
  const mi = toNum(l?.menuItem?.price);
  if (mi !== undefined) return mi;

  const upc = toNum(l?.unitPriceCents);
  if (upc !== undefined) return upc / 100;
  const up = toNum(l?.unitPrice);
  if (up !== undefined) return up;

  const qty = getLineQty(l);
  const totC = toNum(l?.totalCents);
  if (totC !== undefined && qty > 0) {
    const per = totC / 100 / qty;
    const addons = perUnitAddonsQ(l);
    const derived = per - addons;
    return derived > 0 ? derived : 0;
  }

  const pc = toNum(l?.priceCents);
  if (pc !== undefined) return pc / 100;
  const p = toNum(l?.price);
  if (p !== undefined) return p;

  return 0;
}

/** Suma por unidad de todos los addons/opciones. */
function perUnitAddonsQ(l: any): number {
  let sum = 0;

  if (Array.isArray(l?.optionGroups)) {
    for (const g of l.optionGroups) {
      const its = Array.isArray(g?.items) ? g.items : [];
      for (const it of its) sum += extractDeltaQ(it);
    }
  }
  if (Array.isArray(l?.options)) {
    for (const g of l.options) {
      const sel = Array.isArray(g?.selected) ? g.selected : [];
      for (const s of sel) sum += extractDeltaQ(s);
    }
  }
  for (const key of ['addons', 'extras', 'modifiers'] as const) {
    const arr = l?.[key];
    if (Array.isArray(arr)) {
      for (const x of arr) {
        if (typeof x === 'string') continue;
        sum += extractDeltaQ(x);
      }
    }
  }
  return sum;
}

function extractDeltaQ(x: any): number {
  const a = toNum(x?.priceDelta);
  if (a !== undefined) return a;
  const b = toNum(x?.priceExtra);
  if (b !== undefined) return b;
  const ac = toNum(x?.priceDeltaCents);
  if (ac !== undefined) return ac / 100;
  const bc = toNum(x?.priceExtraCents);
  if (bc !== undefined) return bc / 100;
  const p = toNum(x?.price);
  if (p !== undefined) return p;
  const pc = toNum(x?.priceCents);
  if (pc !== undefined) return pc / 100;
  return 0;
}

function lineTotalQ(l: any): number {
  const qty = getLineQty(l);
  const totC = toNum(l?.totalCents);
  if (totC !== undefined) return totC / 100;
  const base = baseUnitPriceQ(l);
  const deltas = perUnitAddonsQ(l);
  return (base + deltas) * qty;
}
function preferredLines(o: OrderDoc): OrderItemLine[] {
  return (Array.isArray(o.items) && o.items.length ? o.items! : (Array.isArray(o.lines) ? o.lines! : [])) as OrderItemLine[];
}

/** Totales (prioriza esquema nuevo) */
function computeOrderTotalsQ(o: OrderDoc) {
  const lines = preferredLines(o);
  const subtotalFresh = lines.length > 0
    ? lines.reduce((acc, l) => acc + lineTotalQ(l), 0)
    : undefined;

  if (o?.totals && (o.totals.subtotal !== undefined || (o.totals as any).deliveryFee !== undefined || (o.totals as any).tip !== undefined)) {
    let subtotal = Number(o.totals.subtotal || 0);
    if (typeof subtotalFresh === 'number') subtotal = subtotalFresh;

    const deliveryFee = Number((o.totals as any).deliveryFee || 0);
    const tip = Number((o.totals as any).tip || 0);
    const discount = Number((o.totals as any).discount || 0);
    const total = Number.isFinite(o.orderTotal) ? Number(o.orderTotal) : (subtotal + deliveryFee + tip - discount);

    return { subtotal, tax: 0, serviceFee: 0, discount, tip, deliveryFee, total };
  }

  if (o?.amounts && Number.isFinite(o.amounts.total)) {
    let subtotal = Number(o.amounts.subtotal || 0);
    if (typeof subtotalFresh === 'number') subtotal = subtotalFresh;

    return {
      subtotal,
      tax: Number(o.amounts.tax || 0),
      serviceFee: Number(o.amounts.serviceFee || 0),
      discount: Number(o.amounts.discount || 0),
      tip: Number(o.amounts.tip || 0),
      deliveryFee: 0,
      total: Number(o.amounts.total || 0),
    };
  }

  if (o?.totals && Number.isFinite(o.totals.totalCents)) {
    let subtotal = centsToQ(o.totals.subtotalCents);
    if (typeof subtotalFresh === 'number') subtotal = subtotalFresh;

    const tax = centsToQ(o.totals.taxCents);
    const serviceFee = centsToQ(o.totals.serviceFeeCents);
    const discount = centsToQ(o.totals.discountCents);
    const tip = Number(o.amounts?.tip || 0);
    const total = centsToQ(o.totals.totalCents) + tip;

    return { subtotal, tax, serviceFee, discount, tip, deliveryFee: 0, total };
  }

  const subtotal = subtotalFresh || 0;
  const tip = Number(o.amounts?.tip || 0);
  return { subtotal, tax: 0, serviceFee: 0, discount: 0, tip, deliveryFee: 0, total: subtotal + tip };
}


/* ======= Helpers para mostrar precio unitario/subtotal línea ======= */
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

/* ===================================================
   🆕 Detector de pago PayPal (AGREGADO)
=================================================== */
function isPaypalPaid(o: any): boolean {
  const ok = (s: any) => ['paid','captured','completed','succeeded','approved'].includes(String(s || '').toLowerCase());
  if (o?.payment?.provider === 'paypal' && ok(o?.payment?.status)) return true;
  if (Array.isArray(o?.payments) && o.payments.some((p: any) => p?.provider === 'paypal' && ok(p?.status))) return true;
  if (String(o?.paymentProvider || '').toLowerCase() === 'paypal' && ok(o?.paymentStatus)) return true;
  return false;
}

/* ===================================================
   Data fetching de órdenes (solo kitchen_done → …)
=================================================== */
const STATUS_IN = [
  'kitchen_done',
  'ready_to_close',
  'assigned_to_courier',
  'on_the_way',
  'delivered',
].join(',');
const TYPE_IN = ['dine_in', 'delivery'].join(',');

function useCashierOrders(enabled: boolean, pollMs = 5000) {
  const [orders, setOrders] = useState<OrderDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<any>(null);

  const fetchNow = async () => {
    try {
      setError(null);
      if (!enabled) { setLoading(false); return; }
      const token = await getIdTokenSafe(false);
      if (!token) { setLoading:false; setError('Debes iniciar sesión.'); return; }

      const url = `/api/orders?statusIn=${encodeURIComponent(STATUS_IN)}&typeIn=${encodeURIComponent(TYPE_IN)}&limit=100`;
      const res = await apiFetch(url);
      if (!res.ok) throw new Error(`GET /orders ${res.status}`);
      const data = await res.json();
      const list: OrderDoc[] = ((data.items ?? data.orders) || []).filter((o: any) =>
        o.status !== 'closed' && o.status !== 'cancelled'
      );
      setOrders(list);
      setLoading(false);
    } catch (e: any) {
      setError(e?.message || 'Error');
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNow();
    return () => timer.current && clearInterval(timer.current);
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    timer.current = setInterval(fetchNow, pollMs);
    return () => timer.current && clearInterval(timer.current);
  }, [enabled, pollMs]);

  return { orders, loading, error, refresh: fetchNow } as const;
}

/* ===================================================
   Tarjeta (estilo OPS) + botones de Caja
=================================================== */
function BadgeStatus({ s }: { s: StatusSnake }) {
  // Lang + tt local
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
    const str = translate(lang, key, vars);
    return str === key ? fallback : str;
  };

  const map: Record<StatusSnake, string> = {
    placed: 'bg-primary',
    kitchen_in_progress: 'bg-warning text-dark',
    kitchen_done: 'bg-secondary',
    ready_to_close: 'bg-success',
    assigned_to_courier: 'bg-info text-dark',
    on_the_way: 'bg-info text-dark',
    delivered: 'bg-success',
    closed: 'bg-dark',
    cancelled: 'bg-danger',
    cart: 'bg-light text-dark',
  };
  const cls = `badge ${map[s] || 'bg-light text-dark'}`;
  return <span className={cls}>{tt(statusKey(s), s)}</span>;
}

/* 🆕 Prop para abrir el editor de datos fiscales */
function OrderCard({
  o,
  onClose,
  busy,
  onEditTax, // 🆕
}: {
  o: OrderDoc;
  onClose: (o: OrderDoc) => Promise<void>;
  busy: boolean;
  onEditTax: (o: OrderDoc) => void; // 🆕
}) {
  // Lang + tt local al componente
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
    const str = translate(lang, key, vars);
    return str === key ? fallback : str;
  };

  const fmtQ = useFmtQ(); // ✅ formateador global
  const created = toDate(o.createdAt ?? new Date());
  const totals = computeOrderTotalsQ(o);
  const type = (o.orderInfo?.type?.toLowerCase?.() === 'delivery')
    ? 'delivery'
    : (o.type || (o.deliveryAddress ? 'delivery' : 'dine_in'));
  const lines = preferredLines(o);

  const rawType = o.orderInfo?.type?.toLowerCase?.();
  const uiType = rawType === 'pickup'
    ? tt('admin.cashier.badge.pickup', 'Pickup')
    : (type === 'delivery' ? tt('admin.cashier.badge.delivery', 'delivery') : tt('admin.cashier.badge.dinein', 'dine_in'));

  const deliveryFeeShown =
    type === 'delivery'
      ? (Number.isFinite((totals as any)?.deliveryFee) ? Number((totals as any).deliveryFee) : Number(o.orderInfo?.deliveryOption?.price || 0))
      : 0;

  const discountShown = (() => {
    const d = Number(((o as any)?.totals?.discount) ?? 0);
    if (Number.isFinite(d) && d > 0) return d;
    const promos = (o as any)?.appliedPromotions;
    if (Array.isArray(promos) && promos.length) {
      return promos.reduce((acc: number, p: any) => {
        const a = Number(p?.discountTotal);
        if (Number.isFinite(a)) return acc + a;
        const c = Number(p?.discountTotalCents);
        return acc + (Number.isFinite(c) ? c / 100 : 0);
      }, 0);
    }
    return 0;
  })();

  const promoLabel = (() => {
    const promos = (o as any)?.appliedPromotions;
    if (Array.isArray(promos) && promos.length) {
      const names = promos.map((p: any) => p?.code || p?.name).filter(Boolean);
      if (names.length) return names.join(', ');
    }
    return (o as any)?.promotionCode || null;
  })();

  const grandTotalShown = Number.isFinite(o.orderTotal) ? Number(o.orderTotal) : Number(totals.total || 0);

  return (
    <div className="card shadow-sm position-relative">
      {isPaypalPaid(o) && (
        <span className="badge bg-info text-dark position-absolute" style={{ right: 8, top: 8, zIndex: 2 }}>
          PayPal
        </span>
      )}

      {/* ✅ Cambio visual mínimo: flex-wrap en header */}
      <div className="card-header d-flex align-items-center justify-content-between flex-wrap">
        <div className="d-flex flex-column">
          <div className="fw-semibold">#{o.orderNumber || o.id}</div>
          {(type !== 'delivery' && (o.orderInfo?.table || o.tableNumber)) && (
            <div className="fw-semibold">
              {tt('common.table', 'Table')} {o.orderInfo?.table || o.tableNumber}
            </div>
          )}
          <small className="text-muted">
            {created.toLocaleString()}
          </small>
        </div>
        {/* ✅ Cambio visual mínimo: badges a nueva línea */}
        <div className="d-flex gap-2 align-items-center w-100 justify-content-end mt-2">
          <span className="badge bg-outline-secondary text-dark">{uiType}</span>
          <BadgeStatus s={o.status} />
        </div>
      </div>
      <div className="card-body">
        {type === 'delivery' && (o.orderInfo?.address || o.deliveryAddress) ? (
          <div className="mb-1"><strong>{tt('admin.cashier.deliver', 'Deliver')}:</strong> {o.orderInfo?.address || o.deliveryAddress}</div>
        ) : null}
        {o.orderInfo?.phone ? <div className="mb-1"><strong>{tt('admin.cashier.phone', 'Phone')}:</strong> {o.orderInfo.phone}</div> : null}
        {(o.orderInfo?.notes || o.notes) ? <div className="mb-2"><em>{tt('admin.cashier.note', 'Note')}: {o.orderInfo?.notes || o.notes}</em></div> : null}

        {/* Ítems y addons (con precios por línea) */}
        <div className="mb-2">
          {lines.map((l, idx) => {
            const { baseUnit, addonsUnit, lineTotal, qty } = safeLineTotalsQ(l);
            const name = getLineName(l);

            const groupRows: React.ReactNode[] = [];

            if (Array.isArray(l?.optionGroups)) {
              for (const g of l.optionGroups) {
                const its = Array.isArray(g?.items) ? g.items : [];
                if (!its.length) continue;
                const rows = its.map((it, i) => {
                  const nm = it?.name ?? '';
                  const pr = extractDeltaQ(it);
                  return <span key={i}>{nm}{pr ? ` (${fmtQ(pr)})` : ''}{i < its.length - 1 ? ', ' : ''}</span>;
                });
                groupRows.push(
                  <div className="ms-3 text-muted" key={`og-${idx}-${g.groupId || g.groupName}`}>
                    <span className="fw-semibold">{g?.groupName ?? tt('common.options', 'Options')}:</span> {rows}
                  </div>
                );
              }
            }

            if (Array.isArray(l?.options)) {
              for (const g of l.options) {
                const sel = Array.isArray(g?.selected) ? g.selected : [];
                if (!sel.length) continue;
                const rows = sel.map((s, i) => {
                  const nm = s?.name ?? '';
                  const pr = extractDeltaQ(s);
                  return <span key={i}>{nm}{pr ? ` (${fmtQ(pr)})` : ''}{i < sel.length - 1 ? ', ' : ''}</span>;
                });
                groupRows.push(
                  <div className="ms-3 text-muted" key={`op-${idx}-${g.groupName}`}>
                    <span className="fw-semibold">{g?.groupName ?? tt('common.options', 'Options')}:</span> {rows}
                  </div>
                );
              }
            }

            for (const key of ['addons', 'extras', 'modifiers'] as const) {
              const arr: any[] = (l as any)[key];
              if (Array.isArray(arr) && arr.length) {
                const rows = arr.map((x, i) => {
                  if (typeof x === 'string') return <span key={i}>{x}{i < arr.length - 1 ? ', ' : ''}</span>;
                  const nm = x?.name ?? '';
                  const pr = extractDeltaQ(x);
                  return <span key={i}>{nm}{pr ? ` (${fmtQ(pr)})` : ''}{i < arr.length - 1 ? ', ' : ''}</span>;
                });
                groupRows.push(
                  <div className="ms-3 text-muted" key={`bk-${idx}-${key}`}>
                    <span className="fw-semibold">{tt(`common.${key}`, key[0].toUpperCase() + key.slice(1))}:</span> {rows}
                  </div>
                );
              }
            }

            return (
              <div key={idx} className="small mb-2">
                <div className="d-flex justify-content-between">
                  <div>• {qty} × {name}</div>
                  <div className="text-muted">({fmtQ(baseUnit)} {tt('admin.cashier.each', 'each')})</div>
                </div>
                {groupRows}
                {lineTotal > 0 && (
                  <div className="d-flex justify-content-between">
                    <span className="text-muted">{tt('admin.cashier.lineSubtotal', 'Subtotal line')}</span>
                    <span className="text-muted">{fmtQ(lineTotal)}</span>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* ➕ Desglose (nuevo) — se conserva */}
        <div className="mt-2">
          <div className="d-flex justify-content-between">
            <div>{tt('common.subtotal', 'Subtotal')}</div>
            <div className="fw-semibold">{fmtQ(totals.subtotal)}</div>
          </div>

          {discountShown > 0 && (
            <div className="d-flex justify-content-between text-success">
              <div>{tt('common.discount', 'Discount')}{promoLabel ? ` (${promoLabel})` : ''}</div>
              <div className="fw-semibold">- {fmtQ(discountShown)}</div>
            </div>
          )}

          {type === 'delivery' && (
            <div className="d-flex justify-content-between">
              <div>
                {tt('common.delivery', 'Delivery')}{ o.orderInfo?.deliveryOption?.title ? ` — ${o.orderInfo.deliveryOption.title}` : '' }
              </div>
              <div className="fw-semibold">{fmtQ(deliveryFeeShown)}</div>
            </div>
          )}

          {type !== 'delivery' && Number(totals.tip || 0) > 0 && (
            <div className="d-flex justify-content-between">
              <div>{tt('common.tip', 'Tip')}</div>
              <div className="fw-semibold">{fmtQ(totals.tip)}</div>
            </div>
          )}

          <hr />
          <div className="d-flex justify-content-between">
            <div className="fw-semibold">{tt('common.grandTotal', 'Grand total')}</div>
            <div className="fw-bold">{fmtQ(grandTotalShown)}</div>
          </div>
        </div>

        {(() => {
          const s = (o as any).taxSnapshot as TaxSnapshot;
          return s && (
            <div className="small mt-2">
              <div>{tt('common.subtotal', 'Subtotal')}: {fmtQ(s.totals.subTotalCents / 100)}</div>
              {Array.isArray(s.summaryByRate) && s.summaryByRate.map((r, idx) => (
                <div key={r?.code || idx}>
                  {tt('common.tax', 'Tax')} {(r.rateBps/100).toFixed(2)}%: {fmtQ(r.taxCents / 100)}
                </div>
              ))}
              {Array.isArray(s.surcharges) && s.surcharges.map((x, i) => (
                <div key={i}>
                  {tt('common.serviceCharge', 'Service charge')}: {fmtQ(x.baseCents / 100)}
                  {x.taxCents>0 && <> ({tt('common.tax', 'Tax')} {fmtQ(x.taxCents / 100)})</>}
                </div>
              ))}
              <div className="fw-semibold">{tt('common.total', 'Total')}: {fmtQ(s.totals.grandTotalCents / 100)}</div>
              {s.customer?.taxId && <div>{tt('admin.cashier.customerTaxId', 'Customer Tax ID')}: {s.customer.taxId}</div>}
            </div>
          );
        })()}

        <div className="d-flex justify-content-between align-items-center mt-2">
          <div className="small">
            {tt('common.total', 'Total')}: <span className="fw-semibold">{fmtQ(grandTotalShown)}</span>
            {totals.tip ? <span className="text-muted"> · {tt('common.tip', 'Tip')} {fmtQ(totals.tip)}</span> : null}
          </div>

          <div className="btn-group">
            {/* 🆕 Botón para editar datos fiscales */}
            <button className="btn btn-outline-primary btn-sm" onClick={() => onEditTax(o)}>
              {tt('admin.cashier.editTax', 'Edit tax')}
            </button>
            <a
              className="btn btn-outline-secondary btn-sm"
              href={`/admin/cashier/receipt/${o.id}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              {tt('admin.cashier.printReceipt', 'Print receipt')}
            </a>
            <button className="btn btn-success btn-sm" onClick={() => onClose(o)} disabled={busy}>
              {tt('common.close', 'Close')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ===================================================
   Página /admin/cashier
=================================================== */
function CashierPage_Inner() {
  // Lang + tt en la página
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
    const str = translate(lang, key, vars);
    return str === key ? fallback : str;
  };

  const tenantId = useTenantId(); // ✅ tenant actual
  const { authReady, user } = useAuthClaims();
  const { orders, loading, error, refresh } = useCashierOrders(!!user, 4000);

  const [busyId, setBusyId] = useState<string | null>(null);

  // 🆕 Estado del editor de datos fiscales
  const [showEdit, setShowEdit] = useState(false);
  const [editOrderId, setEditOrderId] = useState<string | null>(null);
  const [editBillingName, setEditBillingName] = useState<string>('');
  const [editTaxId, setEditTaxId] = useState<string>('');
  const [savingTax, setSavingTax] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);

  const startEditTax = (o: OrderDoc) => {
    setEditOrderId(o.id);
    // Prefill desde order.customer / orderInfo / taxSnapshot
    const preName =
      (o.customer?.name ?? '') ||
      (o.orderInfo?.customerName ?? '') ||
      '';
    const preTax =
      (o.customer?.taxId ?? '') ||
      (o.taxSnapshot?.customer?.taxId ?? '') ||
      '';
    setEditBillingName(preName);
    setEditTaxId(preTax);
    setSaveErr(null);
    setShowEdit(true);
  };

  const saveTaxOverride = async () => {
    if (!editOrderId || !tenantId) return;
    try {
      setSavingTax(true);
      setSaveErr(null);
      await ensureFirebaseApp();
      const { getFirestore, doc, updateDoc, getDoc } = await import('firebase/firestore');
      const db = getFirestore();

      // Lee doc actual para comparar y evitar escrituras innecesarias (scoped)
      const snap = await getDoc(doc(db, `tenants/${tenantId}/orders/${editOrderId}`));
      const cur = (snap.exists() ? snap.data() : {}) as any;

      const curName  = cur?.customer?.name ?? cur?.customer?.names ?? '';
      const curTaxId = cur?.customer?.taxId ?? cur?.taxSnapshot?.customer?.taxId ?? '';

      const newName  = (editBillingName ?? '').trim();
      const newTaxId = (editTaxId ?? '').trim();

      // Si no hay cambios reales, cierra sin escribir
      if (newName === curName && newTaxId === curTaxId) {
        setShowEdit(false);
        setEditOrderId(null);
        return;
      }

      // Construye el update solo con campos que cambiaron (scoped)
      const updates: Record<string, any> = { tenantId };
      if (newName !== curName) {
        updates['customer.name'] = newName || null;
      }
      if (newTaxId !== curTaxId) {
        updates['customer.taxId'] = newTaxId || null;
        updates['taxSnapshot.customer.taxId'] = newTaxId || null; // mantener consistencia del snapshot
      }

      if (Object.keys(updates).length > 0) {
        await updateDoc(doc(db, `tenants/${tenantId}/orders/${editOrderId}`), updates);
      }

      setShowEdit(false);
      setEditOrderId(null);
      await refresh(); // ver cambios inmediatamente
    } catch (e: any) {
      setSaveErr(e?.message || tt('admin.cashier.err.saveBilling', 'Could not save billing data.'));
    } finally {
      setSavingTax(false);
    }
  };

  const onClose = async (o: OrderDoc) => {
    try {
      setBusyId(o.id);
      await advanceToClose(o, async () => {}); // encadena pasos permitidos hasta 'closed'

      try {
        if (String(o?.payment?.provider || '').toLowerCase() === 'cash' && tenantId) {
          await setPaymentStatusClosed(o.id, tenantId);
        }
      } catch (e) {
        console.warn('[cashier] setPaymentStatusClosed failed:', e);
      }

      try {
        const profile = await getActiveTaxProfile();
        if (profile?.b2bConfig?.invoiceNumbering?.enabled) {
          await apiFetch(`/api/invoices/issue`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ orderId: o.id }),
          });
          await refresh();
        } else {
          await refresh();
        }
      } catch (e) {
        console.warn('[invoice] issue failed (non-blocking):', e);
        await refresh();
      }
    } catch (e: any) {
      alert(e?.message || tt('admin.cashier.err.close', 'The order could not be closed.'));
    } finally {
      setBusyId(null);
    }
  };

  const dineIn = orders.filter(o => {
    const t = (o.orderInfo?.type?.toLowerCase?.() === 'delivery') ? 'delivery' : (o.type || (o.deliveryAddress ? 'delivery' : 'dine_in'));
    return t === 'dine_in';
  }).slice().sort((a, b) => (toDate(b.createdAt).getTime() - toDate(a.createdAt).getTime()));

  const delivery = orders.filter(o => {
    const t = (o.orderInfo?.type?.toLowerCase?.() === 'delivery') ? 'delivery' : (o.type || (o.deliveryAddress ? 'delivery' : 'dine_in'));
    return t === 'delivery';
  }).slice().sort((a, b) => (toDate(b.createdAt).getTime() - toDate(a.createdAt).getTime()));

  return (
    <ToolGate feature="cashier">
      <div className="container py-3">
        <div className="d-flex align-items-center justify-content-between gap-3 mb-3 sticky-top bg-white py-2" style={{ top: 0, zIndex: 5, borderBottom: '1px solid #eee' }}>
          <div className="d-flex align-items-center gap-3">
            <h1 className="h4 m-0">{tt('admin.cashier.title', 'Cashier')}</h1>
            <span className="text-muted small d-none d-md-inline">
              {tt('admin.cashier.subtitle', 'Orders from {a} onwards. From here you can print and close.', {
                a: translate(lang, 'admin.cashier.status.kitchenReady', {})
              })}
            </span>
          </div>
          <div className="d-flex align-items-center gap-2">
            <button className="btn btn-outline-secondary btn-sm" onClick={() => refresh()}>{tt('common.refresh', 'Refresh')}</button>
          </div>
        </div>

        {!authReady && <div className="text-muted">{tt('common.initSession', 'Initializing session…')}</div>}
        {authReady && !user && <div className="text-danger">{tt('common.notLogged', 'You are not logged in.')}</div>}
        {error && <div className="text-danger">{error}</div>}
        {user && loading && <div className="text-muted">{tt('common.loadingOrders', 'Loading orders...')}</div>}

        {user && !loading && (
          <>
            {/* Dine-in */}
            <section className="mb-4">
              <div className="d-flex align-items-center justify-content-between mb-2">
                <h2 className="h5 m-0">{tt('admin.cashier.dinein', 'Restaurant (Dine-in)')}</h2>
                <span className="badge bg-secondary">{dineIn.length}</span>
              </div>
              {dineIn.length === 0 ? (
                <div className="text-muted small">{tt('admin.cashier.noDinein', 'There are no dine-in orders.')}</div>
              ) : (
                <div className="row g-3">
                  {dineIn.map(o => (
                    <div key={o.id} className="col-12 col-md-6 col-lg-4">
                      <OrderCard o={o} onClose={onClose} busy={busyId === o.id} onEditTax={startEditTax} />
                    </div>
                  ))}
                </div>
              )}
            </section>

            {/* Delivery */}
            <section className="mt-4">
              <div className="d-flex align-items-center justify-content-between mb-2">
                <h2 className="h5 m-0">{tt('admin.cashier.delivery', 'Delivery')}</h2>
                <span className="badge bg-secondary">{delivery.length}</span>
              </div>
              {delivery.length === 0 ? (
                <div className="text-muted small">{tt('admin.cashier.noDelivery', 'There are no delivery orders.')}</div>
              ) : (
                <div className="row g-3">
                  {delivery.map(o => (
                    <div key={o.id} className="col-12 col-md-6 col-lg-4">
                      <OrderCard o={o} onClose={onClose} busy={busyId === o.id} onEditTax={startEditTax} />
                    </div>
                  ))}
                </div>
              )}
            </section>
          </>
        )}

        {/* 🆕 Modal simple controlado para editar datos de facturación */}
        {showEdit && (
          <div
            role="dialog"
            aria-modal="true"
            className="position-fixed top-0 start-0 w-100 h-100"
            style={{ background: 'rgba(0,0,0,0.35)', zIndex: 1050 }}
            onClick={(e) => {
              if (e.target === e.currentTarget) setShowEdit(false);
            }}
          >
            <div className="position-absolute top-50 start-50 translate-middle" style={{ minWidth: 320, width: 'min(92vw, 520px)' }}>
              <div className="card shadow">
                <div className="card-header d-flex justify-content-between align-items-center">
                  <span className="fw-semibold">{tt('admin.cashier.editTaxDetails', 'Edit tax details')}</span>
                  <button className="btn btn-sm btn-outline-secondary" onClick={() => setShowEdit(false)} aria-label={tt('common.close', 'Close')}>✕</button>
                </div>
                <div className="card-body">
                  <div className="mb-3">
                    <label className="form-label">{tt('admin.cashier.billingName', 'Billing name')}</label>
                    <input
                      type="text"
                      className="form-control"
                      value={editBillingName}
                      onChange={(e) => setEditBillingName(e.target.value)}
                      placeholder={tt('admin.cashier.billingPh', 'Full name or company')}
                    />
                  </div>
                  <div className="mb-2">
                    <label className="form-label">{tt('admin.cashier.taxId', 'Tax ID')}</label>
                    <input
                      type="text"
                      className="form-control"
                      value={editTaxId}
                      onChange={(e) => setEditTaxId(e.target.value)}
                      placeholder={tt('admin.cashier.taxIdPh', 'e.g. NIT / VAT')}
                    />
                  </div>
                  {saveErr && <div className="text-danger small mb-2">{saveErr}</div>}
                </div>
                <div className="card-footer d-flex justify-content-end gap-2">
                  <button className="btn btn-outline-secondary" onClick={() => setShowEdit(false)} disabled={savingTax}>
                    {tt('common.cancel', 'Cancel')}
                  </button>
                  <button className="btn btn-primary" onClick={saveTaxOverride} disabled={savingTax || !editOrderId}>
                    {savingTax ? tt('common.saving', 'Saving…') : tt('common.save', 'Save')}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </ToolGate>
  );
}


export default function CashierPage() {
  return (
    <OnlyCashier>
      <CashierPage_Inner />
    </OnlyCashier>
  );
}
