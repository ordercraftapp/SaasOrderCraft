// src/app/(tenant)/[tenant]/app/admin/delivery/page.tsx
'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Protected from "@/app/(tenant)/[tenantId]/components/Protected";
import { OnlyDelivery } from "@/app/(tenant)/[tenantId]/components/Only";

/* 🔐 Gate por plan */
import ToolGate from "@/components/ToolGate";

/* ✅ i18n (alineado a Kitchen) */
import { useTenantSettings } from '@/lib/settings/hooks';
import { t as T } from '@/lib/i18n/t';

/* --------------------------------------------
   Fallback i18n (evita mostrar las keys crudas)
--------------------------------------------- */
const FALLBACK: Record<string, string> = {
  // Top / page
  'delivery.page.title': 'Delivery — Assignment and Route',
  'common.search': 'Search',
  'common.refresh': 'Refresh',
  'delivery.search.placeholder': '#order, address, phone, item, note',
  'delivery.top.initializing': 'Initializing session…',
  'delivery.top.signIn': 'Sign in to view orders.',
  'delivery.top.loading': 'Loading orders…',

  // Sections
  'delivery.sections.readyToAssign.title': 'Ready to assign',
  'delivery.sections.readyToAssign.empty': 'There are no orders ready to assign.',
  'delivery.sections.inRoute.title': 'In route',
  'delivery.sections.inRoute.empty': 'There are no orders en route.',
  'delivery.sections.delivered.title': 'Delivered',
  'delivery.sections.delivered.empty': 'No deliveries recorded.',

  // Status / track
  'track.badge.delivery': 'delivery',
  'track.status.cart': 'Cart',
  'track.status.received': 'Received',
  'track.status.inKitchen': 'In kitchen',
  'track.status.kitchenReady': 'Kitchen ready',
  'track.status.readyToClose': 'Ready to close',
  'track.status.assigned': 'Assigned to delivery',
  'track.status.onTheWay': 'In route',
  'track.status.delivered': 'Delivered',
  'track.status.closed': 'Closed',
  'track.status.cancelled': 'Cancelled',

  // Relative time
  'delivery.time.secondsAgo': 'seconds ago',
  'delivery.time.minAgo': 'min {m} ago',
  'delivery.time.hAndMinAgo': 'h {h} m {m} ago',

  // Card
  'delivery.card.deliveryBy': 'Delivery',
  'delivery.card.address': 'Address',
  'delivery.card.addressNotes': 'Address notes',
  'delivery.card.phone': 'Phone',
  'delivery.card.orderNotes': 'Order notes',
  'delivery.card.status': 'Status',
  'delivery.card.printTicket': 'Print ticket',
  'delivery.card.take': 'Take',
  'delivery.card.inRoute': 'In route',
  'delivery.card.delivered': 'Delivered',

  // Tooltips
  'delivery.card.tooltip.print': 'Print delivery ticket',
  'delivery.card.tooltip.take': 'Assign delivery person and take order',
  'delivery.card.tooltip.inRoute': 'In route',
  'delivery.card.tooltip.delivered': 'Mark as delivered',

  // Modal
  'delivery.modal.assignTitle': 'Assign delivery',
  'delivery.modal.driverName': "Delivery driver's name",
  'delivery.modal.driverPlaceholder': 'Ex. John Snow',
  'delivery.modal.cancel': 'Cancel',
  'delivery.modal.saveAndTake': 'Save and take',

  // Print
  'delivery.print.title': 'Ticket delivery',
  'delivery.print.order': 'Order:',
  'delivery.print.client': 'Client:',
  'delivery.print.phone': 'Phone:',
  'delivery.print.address': 'Address:',
  'delivery.print.additionalNotes': 'Additional notes:',
  'delivery.print.products': 'Products:',
  'delivery.print.printBtn': 'Print',
  'delivery.print.closeBtn': 'Close',
};

/** Interpola variables simples tipo {m}, {h} */
function fmtVars(s: string, vars?: Record<string, any>) {
  if (!vars) return s;
  return s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? `{${k}}`));
}

/** ✅ tt: usa tenant.language (LS) → settings.language; si falla, usa FALLBACK */
function useTT() {
  const { settings } = useTenantSettings();

  // igual que Kitchen: primero localStorage('tenant.language'), luego settings.language
  const lang = useMemo(() => {
    try {
      if (typeof window !== 'undefined') {
        const ls = localStorage.getItem('tenant.language');
        if (ls) return ls;
      }
    } catch {}
    return (settings as any)?.language;
  }, [settings]);

  return useMemo(() => {
    return (key: string, vars?: Record<string, any>) => {
      const v = T(lang, key, vars);
      if (!v || v === key) {
        const fb = FALLBACK[key] ?? key;
        return fmtVars(fb, vars);
      }
      return v;
    };
  }, [lang]);
}

/* --------------------------------------------
   Firebase init (patrón similar a Kitchen)
--------------------------------------------- */
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

/* --------------------------------------------
   Firebase Auth helpers
--------------------------------------------- */
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

/* --------------------------------------------
   Fetch helper con reintento 401
--------------------------------------------- */
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

/* --------------------------------------------
   Types
--------------------------------------------- */
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

type OrderItemLine = {
  menuItemName?: string;
  quantity?: number;
  optionGroups?: Array<{
    groupId?: string;
    groupName?: string;
    type?: 'single' | 'multiple';
    items: Array<{ id?: string; name?: string; priceDelta?: number }>;
  }>;
  options?: Array<{ groupName: string; selected: Array<{ name: string; priceDelta?: number }> }>;
  addons?: Array<string | { name: string; priceDelta?: number }>;
  extras?: Array<string | { name: string; priceDelta?: number }>;
  modifiers?: Array<string | { name: string; priceDelta?: number }>;
  groupItems?: Array<string | { name: string }>;
};

type OrderDoc = {
  id: string;
  orderNumber?: string;
  type?: 'dine_in' | 'delivery';
  status: StatusSnake;
  items?: OrderItemLine[];
  lines?: OrderItemLine[];
  createdAt?: any;
  notes?: string | null;
  tableNumber?: string | null;
  deliveryAddress?: string | null;
  orderInfo?: {
    type?: 'dine-in' | 'delivery';
    table?: string;
    notes?: string;
    address?: string;
    phone?: string;
    delivery?: 'pending' | 'inroute' | 'delivered';
    courierName?: string | null;

    customerName?: string;
    addressLabel?: 'home' | 'office';
    addressInfo?: {
      line1?: string; city?: string; country?: string; zip?: string; notes?: string;
    };
    addressNotes?: string;

    deliveredAt?: any;
    deliveryAt?: any;
  } | any;

  deliveredAt?: any;
  deliveryDeliveredAt?: any;

  statusHistory?: Array<{ at?: any; to?: string }>;
};

/* --------------------------------------------
   Utils y helpers (alineados con Kitchen)
--------------------------------------------- */
function statusLabel(s: StatusSnake, tt: (k: string) => string): string {
  switch (s) {
    case 'cart': return tt('track.status.cart');
    case 'placed': return tt('track.status.received');
    case 'kitchen_in_progress': return tt('track.status.inKitchen');
    case 'kitchen_done': return tt('track.status.kitchenReady');
    case 'ready_to_close': return tt('track.status.readyToClose');
    case 'assigned_to_courier': return tt('track.status.assigned');
    case 'on_the_way': return tt('track.status.onTheWay');
    case 'delivered': return tt('track.status.delivered');
    case 'closed': return tt('track.status.closed');
    case 'cancelled': return tt('track.status.cancelled');
    default: return s;
  }
}
function toDate(x: any): Date {
  if (x?.toDate?.() instanceof Date) return x.toDate();
  const d = new Date(x);
  return isNaN(d.getTime()) ? new Date() : d;
}
function timeAgo(from: Date, now: Date, tt: (k: string, v?: any) => string) {
  const ms = Math.max(0, now.getTime() - from.getTime());
  const m = Math.floor(ms / 60000);
  if (m < 1) return tt('delivery.time.secondsAgo');
  if (m < 60) return tt('delivery.time.minAgo', { m });
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return tt('delivery.time.hAndMinAgo', { h, m: rem });
}
function toSnakeStatus(s: string): StatusSnake {
  if (!s) return 'placed';
  const snake = s.includes('_') ? s : s.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
  const aliasMap: Record<string, StatusSnake> = {
    ready: 'ready_to_close',
    served: 'ready_to_close',
    completed: 'closed',
    ready_for_delivery: 'assigned_to_courier',
    out_for_delivery: 'on_the_way',
  };
  return (aliasMap[snake] ?? (snake as StatusSnake)) as StatusSnake;
}

/* ✅ NUEVO: util para ms (Date | Firestore | string) */
function tsMs(x: any): number {
  try {
    if (!x) return 0;
    if (typeof x?.toDate === 'function') return x.toDate().getTime();
    if (typeof x?.seconds === 'number') return x.seconds * 1000;
    const t = new Date(x).getTime();
    return Number.isFinite(t) ? t : 0;
  } catch { return 0; }
}

/* ✅ NUEVO: detectar cuándo pasó a delivered (con fallbacks) */
function getDeliveredAtMs(o: any): number | null {
  const cand =
    o?.orderInfo?.deliveredAt ??
    o?.orderInfo?.deliveryAt ??
    o?.deliveredAt ??
    o?.deliveryDeliveredAt ??
    null;

  if (cand) {
    const t = tsMs(cand);
    if (t > 0) return t;
  }

  const hist: any[] = Array.isArray(o?.statusHistory) ? o.statusHistory : [];
  const hit = hist.find((h) => String(h?.to || '').toLowerCase() === 'delivered');
  if (hit?.at) {
    const t = tsMs(hit.at);
    if (t > 0) return t;
  }

  const created = tsMs(o?.createdAt);
  return created > 0 ? created : null;
}

/* ---- Lectura de tipo/datos desde orderInfo (compat con Kitchen/Checkout) ---- */
function getDisplayType(o: OrderDoc): 'dine_in' | 'delivery' {
  const infoType = String(o?.orderInfo?.type || '').toLowerCase();
  if (infoType === 'delivery') return 'delivery';
  if (infoType === 'dine-in' || infoType === 'dine_in') return 'dine_in';
  if (o.type === 'delivery') return 'delivery';
  if (o.type === 'dine_in') return 'dine_in';
  if (o.deliveryAddress) return 'delivery';
  return 'dine_in';
}
function getDisplayNotes(o: OrderDoc): string | null {
  const n = o?.orderInfo?.notes;
  if (n) return String(n);
  return o.notes ?? null;
}
function getDisplayAddress(o: OrderDoc): string | null {
  const a = o?.orderInfo?.address;
  if (a) return String(a);
  return o.deliveryAddress ?? null;
}
function getDisplayPhone(o: OrderDoc): string | null {
  const p = o?.orderInfo?.phone;
  if (p) return String(p);
  return null;
}
function getLineQty(l: any): number {
  return Number(l?.quantity ?? l?.qty ?? 1) || 1;
}
function getLineName(l: any): string {
  return String(l?.menuItemName ?? l?.name ?? l?.menuItem?.name ?? 'Ítem');
}
/** Unifica option-groups, options, addons, etc. */
function normalizeOptions(l: any): Array<{ label: string; values: string[] }> {
  const res: Array<{ label: string; values: string[] }> = [];
  if (Array.isArray(l?.optionGroups) && l.optionGroups.length) {
    for (const g of l.optionGroups) {
      const label = String(g?.groupName ?? 'Options');
      const values = Array.isArray(g?.items)
        ? g.items.map((it: any) => String(it?.name ?? it)).filter(Boolean)
        : [];
      if (values.length) res.push({ label, values });
    }
  }
  if (Array.isArray(l?.options) && l.options.length) {
    for (const g of l.options) {
      const label = String(g?.groupName ?? 'Options');
      const values = Array.isArray(g?.selected)
        ? g.selected.map((s: any) => String(s?.name ?? s)).filter(Boolean)
        : [];
      if (values.length) res.push({ label, values });
    }
  }
  const buckets = [
    { key: 'addons', label: 'Addons' },
    { key: 'extras', label: 'Extras' },
    { key: 'modifiers', label: 'Modifiers' },
  ] as const;
  for (const b of buckets) {
    const arr = l?.[b.key];
    if (Array.isArray(arr) && arr.length) {
      const values = arr
        .map((x: any) => (typeof x === 'string' ? x : x?.name ? String(x.name) : null))
        .filter(Boolean) as string[];
      if (values.length) res.push({ label: b.label, values });
    }
  }
  if (Array.isArray(l?.groupItems) && l.groupItems.length) {
    const values = l.groupItems
      .map((x: any) => (typeof x === 'string' ? x : x?.name ? String(x.name) : null))
      .filter(Boolean) as string[];
    if (values.length) res.push({ label: 'Group items', values });
  }
  return res;
}

/* --------------------------------------------
   Dirección completa + notas (de addressInfo/addressNotes)
--------------------------------------------- */
function buildFullAddress(o: OrderDoc): { full: string | null; notes: string | null } {
  const info = o?.orderInfo || {};
  const ai = info?.addressInfo || {};
  const parts = [
    ai?.line1 ? String(ai.line1) : null,
    ai?.city ? String(ai.city) : null,
    ai?.country ? String(ai.country) : null,
  ].filter(Boolean) as string[];

  let full: string | null = null;
  if (parts.length) {
    full = parts.join(', ');
    if (ai?.zip) {
      full = `${full} ${String(ai.zip)}`;
    }
  } else {
    full = getDisplayAddress(o);
  }

  const note = (ai?.notes && String(ai.notes)) || (info?.addressNotes && String(info.addressNotes)) || null;
  return { full, notes: note };
}

/* --------------------------------------------
   Hook de órdenes (trae también closed y delivered)
--------------------------------------------- */
const STATUS_QUERY_MAIN = [
  'kitchen_done',
  'assigned_to_courier',
  'on_the_way',
  'ready_to_close',
  'closed',
  'delivered',
].join(',');
const TYPE_QUERY = ['delivery'].join(',');

function useDeliveryOrders(enabled: boolean, pollMs = 4000) {
  const [orders, setOrders] = useState<OrderDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<any>(null);

  const fetchNow = async () => {
    try {
      setError(null);
      if (!enabled) { setLoading(false); return; }
      const token = await getIdTokenSafe(false);
      if (!token) { setLoading(false); setError('You must log in.'); return; }

      const url = `/api/orders?statusIn=${encodeURIComponent(STATUS_QUERY_MAIN)}&typeIn=${encodeURIComponent(TYPE_QUERY)}&limit=100`;
      const res = await apiFetch(url);
      if (res.status === 401) throw new Error('Unauthorized (401).');
      if (!res.ok) throw new Error(`GET /orders ${res.status}`);

      const data = await res.json();
      const rawList = (data.items ?? data.orders ?? []) as any[];
      const listRaw: OrderDoc[] = (rawList || []).map((d) => ({ ...d, status: toSnakeStatus(String(d.status || 'placed')) }));

      const list = listRaw
        .filter(o => getDisplayType(o) === 'delivery')
        .sort((a, b) => {
          const ta = a.createdAt?._seconds ? a.createdAt._seconds * 1000 : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
          const tb = b.createdAt?._seconds ? b.createdAt._seconds * 1000 : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
          return tb - ta;
        });

      setOrders(list);
      setLoading(false);
    } catch (e: any) {
      setError(e?.message || 'Error loading');
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

/* --------------------------------------------
   PATCH sub-estado: courierName / delivery
--------------------------------------------- */
async function updateDeliveryMeta(
  orderId: string,
  patch: { courierName?: string | null; delivery?: 'pending' | 'inroute' | 'delivered' }
) {
  const res = await apiFetch(`/api/orders/${orderId}/delivery`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data?.error || `PATCH /delivery ${res.status}`);
  }
  return res.json();
}

/* --------------------------------------------
   ✅ AGREGADO: disparar correo "Order Delivered"
--------------------------------------------- */
async function triggerDeliveredEmail(orderId: string) {
  try {
    const res = await apiFetch(`/api/tx/order-delivered`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ orderId }),
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      console.error('[delivery] order-delivered failed', res.status, err?.error || err);
    }
  } catch (e) {
    console.error('[delivery] order-delivered exception', e);
  }
}

/* --------------------------------------------
   UI helpers
--------------------------------------------- */
function BadgeStatus({ s, tt }: { s: StatusSnake, tt: (k: string) => string }) {
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
  return <span className={cls}>{statusLabel(s, tt)}</span>;
}

/* --------------------------------------------
   Modal para capturar nombre del repartidor
--------------------------------------------- */
function CourierModal({
  show,
  defaultName,
  onClose,
  onSave,
  tt,
}: {
  show: boolean;
  defaultName?: string | null;
  onClose: () => void;
  onSave: (name: string) => void;
  tt: (k: string, v?: any) => string;
}) {
  const [name, setName] = useState(defaultName ?? '');
  useEffect(() => { setName(defaultName ?? ''); }, [defaultName, show]);

  if (!show) return null;
  return (
    <div className="modal d-block" tabIndex={-1} style={{ background: 'rgba(0,0,0,0.25)' }}>
      <div className="modal-dialog">
        <div className="modal-content shadow">
          <div className="modal-header">
            <h5 className="modal-title">{tt('delivery.modal.assignTitle')}</h5>
            <button type="button" className="btn-close" onClick={onClose} />
          </div>
          <div className="modal-body">
            <label className="form-label">{tt('delivery.modal.driverName')}</label>
            <input
              className="form-control"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={tt('delivery.modal.driverPlaceholder')}
              autoFocus
            />
          </div>
          <div className="modal-footer">
            <button className="btn btn-outline-secondary" onClick={onClose}>{tt('delivery.modal.cancel')}</button>
            <button
              className="btn btn-primary"
              onClick={() => {
                const v = name.trim();
                if (!v) return;
                onSave(v);
              }}
            >
              {tt('delivery.modal.saveAndTake')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------
   Impresión de ticket
--------------------------------------------- */
function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;' }[c]!));
}
function printDeliveryTicket(o: OrderDoc, tt: (k: string) => string) {
  const created = toDate(o.createdAt ?? new Date());
  const info = o?.orderInfo || {};
  const customer = (info?.customerName && String(info.customerName)) || '—';
  const phone = (info?.phone && String(info.phone)) || '—';
  const { full, notes } = buildFullAddress(o);

  const lines = (o.items?.length ? o.items : o.lines || []) as OrderItemLine[];
  const itemsText = lines.map((it) => {
    const qty = getLineQty(it);
    const name = getLineName(it);
    const groups = normalizeOptions(it);
    const opts = groups.map(g => `    - ${g.label}: ${g.values.join(', ')}`).join('\n');
    return `  • ${qty} × ${name}${opts ? '\n' + opts : ''}`;
  }).join('\n');

  const docHtml = `<!doctype html>
<html>
<head>
<meta charset="utf-8" />
<title>${escapeHtml(tt('delivery.print.title'))} #${escapeHtml(o.orderNumber || o.id)}</title>
<style>
  html, body { margin: 0; padding: 0; }
  body { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; font-size: 12px; padding: 12px; }
  h1 { font-size: 14px; margin: 0 0 8px; }
  .muted { color: #666; }
  .row { margin-bottom: 8px; }
  pre { white-space: pre-wrap; word-wrap: break-word; }
  @media print {
    body { font-size: 12px; }
    .no-print { display: none !important; }
  }
</style>
</head>
<body>
  <h1>${escapeHtml(tt('delivery.print.title'))}</h1>
  <div class="row"><strong>${escapeHtml(tt('delivery.print.order'))}</strong> #${escapeHtml(o.orderNumber || o.id)}</div>
  <div class="row muted">${escapeHtml(created.toLocaleString())}</div>
  <div class="row"><strong>${escapeHtml(tt('delivery.print.client'))}</strong> ${escapeHtml(customer)}</div>
  <div class="row"><strong>${escapeHtml(tt('delivery.print.phone'))}</strong> ${escapeHtml(phone)}</div>
  <div class="row"><strong>${escapeHtml(tt('delivery.print.address'))}</strong> ${escapeHtml(full || '—')}</div>
  ${notes ? `<div class="row"><strong>${escapeHtml(tt('delivery.print.additionalNotes'))}</strong> ${escapeHtml(notes)}</div>` : ''}
  <hr/>
  <div class="row"><strong>${escapeHtml(tt('delivery.print.products'))}</strong></div>
  <pre>${escapeHtml(itemsText || '—')}</pre>

  <div class="no-print" style="margin-top:12px;">
    <button onclick="window.print()">${escapeHtml(tt('delivery.print.printBtn'))}</button>
    <button onclick="window.close()">${escapeHtml(tt('delivery.print.closeBtn'))}</button>
  </div>
</body>
</html>`;

  const w = window.open('', 'printTicket', 'width=480,height=640');
  if (!w) {
    alert('Could not open print window (pop-up blocked).');
    return;
  }
  w.document.open();
  w.document.write(docHtml);
  w.document.close();
  try { w.focus(); } catch {}
}

/* --------------------------------------------
   Tarjeta de Delivery (solo sub-estado)
--------------------------------------------- */
function DeliveryCard({
  o,
  onRefresh,
  tt,
}: {
  o: OrderDoc;
  onRefresh: () => Promise<void> | void;
  tt: (k: string, v?: any) => string;
}) {
  const created = toDate(o.createdAt ?? new Date());
  const phone = getDisplayPhone(o);
  const notes = getDisplayNotes(o);
  const courierName: string | null = o?.orderInfo?.courierName ?? null;
  const subState: 'pending' | 'inroute' | 'delivered' = o?.orderInfo?.delivery ?? 'pending';

  const isDelivery = getDisplayType(o) === 'delivery';

  const canTake   = isDelivery && subState === 'pending';
  const canGo     = isDelivery && subState === 'pending' && !!(courierName && courierName.trim());
  const canFinish = isDelivery && subState === 'inroute';

  const [busy, setBusy] = useState(false);
  const [showModal, setShowModal] = useState(false);

  async function doAssignWithName(name: string) {
    try {
      setBusy(true);
      await updateDeliveryMeta(o.id, { courierName: name });
      await onRefresh();
    } catch (e: any) {
      alert(e?.message || 'Error');
    } finally {
      setBusy(false);
      setShowModal(false);
    }
  }
  const doOut = async () => {
    try {
      setBusy(true);
      await updateDeliveryMeta(o.id, { delivery: 'inroute' });
    } catch (e: any) {
      alert(e?.message || 'Error');
    } finally {
      setBusy(false);
      await onRefresh();
    }
  };
  const doDelivered = async () => {
    try {
      setBusy(true);
      await updateDeliveryMeta(o.id, { delivery: 'delivered' });
      await triggerDeliveredEmail(o.id);
      await onRefresh();
    } catch (e: any) {
      alert(e?.message || 'Error');
    } finally {
      setBusy(false);
    }
  };

  const lines = (o.items?.length ? o.items : o.lines || []);

  const { full: fullAddress, notes: addressNote } = buildFullAddress(o);

  return (
    <>
      <div className="card shadow-sm">
        <div className="card-header d-flex align-items-center justify-content-between flex-wrap">
          <div className="d-flex flex-column">
            <div className="fw-semibold">#{o.orderNumber || o.id}</div>
            <small className="text-muted">
              {created.toLocaleString()} · {timeAgo(created, new Date(), tt)}
            </small>
            {courierName && <small className="text-muted">{tt('delivery.card.deliveryBy')}: <strong>{courierName}</strong></small>}
          </div>
          <div className="d-flex gap-2 align-items-center w-100 justify-content-end mt-2">
            <span className="badge bg-outline-secondary text-dark">{tt('track.badge.delivery')}</span>
            <BadgeStatus s={o.status} tt={tt} />
          </div>
        </div>

        <div className="card-body">
          <div className="mb-2">
            <div><span className="fw-semibold">{tt('delivery.card.address')}:</span> {fullAddress || <em className="text-muted">—</em>}</div>
            {addressNote ? (
              <div><span className="fw-semibold">{tt('delivery.card.addressNotes')}:</span> {addressNote}</div>
            ) : null}
            <div><span className="fw-semibold">{tt('delivery.card.phone')}:</span> {phone || <em className="text-muted">—</em>}</div>
            {notes ? <div><span className="fw-semibold">{tt('delivery.card.orderNotes')}:</span> {notes}</div> : null}
            <div className="small text-muted">{tt('delivery.card.status')}: {subState}</div>
          </div>

          <div className="mb-2">
            {lines.map((it: any, idx: number) => {
              const groups = normalizeOptions(it);
              return (
                <div key={idx} className="small mb-1">
                  • {getLineQty(it)} × {getLineName(it)}
                  {!!groups.length && (
                    <div className="ms-3 text-muted">
                      {groups.map((g, ix) => (
                        <div key={ix}>
                          <span className="fw-semibold">{g.label}:</span>{' '}
                          <span>{g.values.join(', ')}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="d-flex justify-content-end">
            <div className="btn-group">
              <button
                className="btn btn-outline-dark btn-sm"
                onClick={() => printDeliveryTicket(o, (k) => tt(k))}
                title={tt('delivery.card.tooltip.print')}
              >
                {tt('delivery.card.printTicket')}
              </button>

              <button className="btn btn-outline-secondary btn-sm" disabled>{statusLabel(o.status, (k) => tt(k))}</button>

              {canTake && (
                <button
                  className="btn btn-primary btn-sm"
                  disabled={busy}
                  onClick={() => setShowModal(true)}
                  title={tt('delivery.card.tooltip.take')}
                >
                  {tt('delivery.card.take')}
                </button>
              )}
              {canGo && (
                <button className="btn btn-primary btn-sm" disabled={busy} onClick={doOut} title={tt('delivery.card.tooltip.inRoute')}>
                  {tt('delivery.card.inRoute')}
                </button>
              )}
              {canFinish && (
                <button className="btn btn-success btn-sm" disabled={busy} onClick={doDelivered} title={tt('delivery.card.tooltip.delivered')}>
                  {tt('delivery.card.delivered')}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <CourierModal
        show={showModal}
        defaultName={courierName}
        onClose={() => setShowModal(false)}
        onSave={doAssignWithName}
        tt={tt}
      />
    </>
  );
}

/* --------------------------------------------
   Página /delivery (3 secciones)
--------------------------------------------- */
function DeliveryBoardPageInner() {
  const { authReady, user } = useAuthState();
  const tt = useTT();
  const { orders, loading, error, refresh } = useDeliveryOrders(!!user, 4000);

  const [q, setQ] = useState('');
  const term = q.trim().toLowerCase();

  const filtered = useMemo(() => {
    return orders.filter((o) => {
      if (!term) return true;
      const address = getDisplayAddress(o) ?? '';
      const phone = getDisplayPhone(o) ?? '';
      const notes = getDisplayNotes(o) ?? '';
      const hay = [
        o.orderNumber, o.id, address, phone, notes,
        ...(o.items?.map(i => i.menuItemName || '') || []),
      ].join(' ').toLowerCase();
      return hay.includes(term);
    });
  }, [orders, term]);

  const listosParaAsignar = useMemo(
    () =>
      filtered.filter(
        (o) =>
          (o.status === 'kitchen_done' || o.status === 'closed') &&
          String(o?.orderInfo?.delivery ?? 'pending') === 'pending'
      ),
    [filtered]
  );

  const enRuta = useMemo(
    () => filtered.filter(o => String(o?.orderInfo?.delivery ?? '') === 'inroute'),
    [filtered]
  );

  const entregados = useMemo(() => {
    const DAY_MS = 24 * 60 * 60 * 1000;
    const now = Date.now();
    return filtered.filter(o => {
      if (String(o?.orderInfo?.delivery ?? '') !== 'delivered') return false;
      const whenMs = getDeliveredAtMs(o);
      if (!whenMs) return false;
      return (now - whenMs) < DAY_MS;
    });
  }, [filtered]);

  return (
    <div className="container py-3">
      <div className="d-flex align-items-center justify-content-between mb-3 gap-2 flex-wrap">
        <h1 className="h4 m-0">{tt('delivery.page.title')}</h1>
        <div className="d-flex align-items-center gap-2">
          <div className="input-group input-group-sm" style={{ width: 280 }}>
            <span className="input-group-text">{tt('common.search')}</span>
            <input
              type="search"
              className="form-control"
              placeholder={tt('delivery.search.placeholder')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <button className="btn btn-outline-secondary btn-sm" onClick={() => refresh()}>{tt('common.refresh')}</button>
        </div>
      </div>

      {!authReady && <div className="text-muted">{tt('delivery.top.initializing')}</div>}
      {authReady && !user && <div className="text-danger">{tt('delivery.top.signIn')}</div>}
      {error && <div className="text-danger">{error}</div>}
      {user && loading && <div className="text-muted">{tt('delivery.top.loading')}</div>}

      {user && (
        <>
          {/* 1) Listos para asignar */}
          <section className="mb-4">
            <div className="d-flex align-items-center justify-content-between mb-2">
              <h2 className="h5 m-0">{tt('delivery.sections.readyToAssign.title')}</h2>
              <span className="badge bg-secondary">{listosParaAsignar.length}</span>
            </div>
            {listosParaAsignar.length === 0 ? (
              <div className="text-muted small">{tt('delivery.sections.readyToAssign.empty')}</div>
            ) : (
              <div className="row g-3">
                {listosParaAsignar.map((o) => (
                  <div key={o.id} className="col-12 col-md-6 col-lg-4">
                    <DeliveryCard o={o} onRefresh={refresh} tt={tt} />
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 2) En ruta */}
          <section className="mb-4">
            <div className="d-flex align-items-center justify-content-between mb-2">
              <h2 className="h5 m-0">{tt('delivery.sections.inRoute.title')}</h2>
              <span className="badge bg-secondary">{enRuta.length}</span>
            </div>
            {enRuta.length === 0 ? (
              <div className="text-muted small">{tt('delivery.sections.inRoute.empty')}</div>
            ) : (
              <div className="row g-3">
                {enRuta.map((o) => (
                  <div key={o.id} className="col-12 col-md-6 col-lg-4">
                    <DeliveryCard o={o} onRefresh={refresh} tt={tt} />
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* 3) Entregados */}
          <section className="mb-4">
            <div className="d-flex align-items-center justify-content-between mb-2">
              <h2 className="h5 m-0">{tt('delivery.sections.delivered.title')}</h2>
              <span className="badge bg-secondary">{entregados.length}</span>
            </div>
            {entregados.length === 0 ? (
              <div className="text-muted small">{tt('delivery.sections.delivered.empty')}</div>
            ) : (
              <div className="row g-3">
                {entregados.map((o) => (
                  <div key={o.id} className="col-12 col-md-6 col-lg-4">
                    <DeliveryCard o={o} onRefresh={refresh} tt={tt} />
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

/* --------------------------------------------
   Export default protegido + gate por plan
--------------------------------------------- */
export default function DeliveryBoardPage() {
  return (
    <Protected>
      <OnlyDelivery>
        <ToolGate feature="delivery">
          <DeliveryBoardPageInner />
        </ToolGate>
      </OnlyDelivery>
    </Protected>
  );
}
