// src/app/(tenant)/[tenantId]/app/admin/kitchen/page.tsx
'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useParams } from 'next/navigation';
import Protected from '@/app/(tenant)/[tenantId]/components/Protected';
import { OnlyKitchen } from "@/app/(tenant)/[tenantId]/components/Only";
import ToolGate from '@/components/ToolGate'; 
import { useAuth } from '@/app/(tenant)/[tenantId]/app/providers';

// 🔤 i18n
import { t as translate } from "@/lib/i18n/t";
import { useTenantSettings } from "@/lib/settings/hooks";

/* --------------------------------------------
   Firebase init (client)
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
      console.warn('[Firebase] Missing NEXT_PUBLIC_* variables; Auth will fail to initialize.');
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

/** Normaliza el nodo del tenant (soporta {roles:{...}} o plano) */
function normalizeTenantNode(node: any): Record<string, any> {
  if (!node) return {};
  if (node.roles && typeof node.roles === 'object') return { ...node.roles };
  return { ...node };
}

/* --------------------------------------------
   API base (tenant-scoped) + fetch helper
--------------------------------------------- */
function useApiBase() {
  const params = useParams();
  const tenantId = String((params as any)?.tenantId ?? (params as any)?.tenant ?? '').trim();
  // Todas las APIs viven bajo: /[tenantId]/app/api/...
  const base = tenantId ? `/${tenantId}/app/api` : `/app/api`;
  return base;
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

/* --------------------------------------------
   Types (SNAKE_CASE)
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
  menuItemName: string;
  quantity: number;
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
  unitPriceCents?: number;
  priceCents?: number;
  price?: number;
  totalCents?: number;
};
type StatusHistoryEntry = {
  at: string;
  by?: string | null;
  from: StatusSnake;
  to: StatusSnake;
  idem?: string | null;
};
type Amounts = {
  subtotal?: number;
  serviceFee?: number;
  discount?: number;
  taxableBase?: number;
  tax?: number;
  tip?: number;
  total?: number;
};
type OrderDoc = {
  id: string;
  orderNumber?: string;
  type?: 'dine_in' | 'delivery';
  status: StatusSnake;
  items: OrderItemLine[];
  amounts?: Amounts;
  totals?: { totalCents?: number };
  tableNumber?: string | null;
  deliveryAddress?: string | null;
  notes?: string | null;
  createdAt?: any;
  statusHistory?: StatusHistoryEntry[];
  lines?: OrderItemLine[];
  orderInfo?: any;

  reopenedAt?: any;
  currentAppendBatchId?: string | null;
  itemsCountBeforeAppend?: number | null;

  modifiedNote?: string | null;
};

/* --------------------------------------------
   Utils (i18n-aware)
--------------------------------------------- */
function statusKey(s: StatusSnake): string {
  const map: Record<StatusSnake, string> = {
    cart: 'admin.kitchen.status.cart',
    placed: 'admin.kitchen.status.received',
    kitchen_in_progress: 'admin.kitchen.status.inKitchen',
    kitchen_done: 'admin.kitchen.status.kitchenReady',
    ready_to_close: 'admin.kitchen.status.readyToClose',
    assigned_to_courier: 'admin.kitchen.status.assigned',
    on_the_way: 'admin.kitchen.status.onTheWay',
    delivered: 'admin.kitchen.status.delivered',
    closed: 'admin.kitchen.status.closed',
    cancelled: 'admin.kitchen.status.cancelled',
  };
  return map[s] || 'admin.kitchen.status.unknown';
}
function toDate(x: any): Date {
  if (x?.toDate?.() instanceof Date) return x.toDate();
  const d = new Date(x);
  return isNaN(d.getTime()) ? new Date() : d;
}
function timeAgo(from: Date, now: Date, tt: (k: string, fb: string, v?: Record<string, unknown>) => string) {
  const ms = Math.max(0, now.getTime() - from.getTime());
  const m = Math.floor(ms / 60000);
  if (m < 1) return tt('admin.kitchen.time.secondsAgo', 'Seconds ago');
  if (m < 60) return tt('admin.kitchen.time.minAgo', 'min {m} ago', { m });
  const h = Math.floor(m / 60);
  const rem = m % 60;
  return tt('admin.kitchen.time.hmsAgo', 'h {h} m {m} ago', { h, m: rem });
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
function byCreatedAtDesc(a: any, b: any) {
  const ta = a.createdAt?._seconds ? a.createdAt._seconds * 1000 : (a.createdAt ? new Date(a.createdAt).getTime() : 0);
  const tb = b.createdAt?._seconds ? b.createdAt._seconds * 1000 : (b.createdAt ? new Date(b.createdAt).getTime() : 0);
  return tb - ta;
}

/* --------------------------------------------
   Flujos por tipo (para 'Atrás' en cocina)
--------------------------------------------- */
const FLOW_KITCHEN_ONLY: StatusSnake[] = ['placed', 'kitchen_in_progress', 'kitchen_done'];
function getPrevKitchen(order: OrderDoc): StatusSnake | null {
  const idx = FLOW_KITCHEN_ONLY.indexOf(order.status);
  if (idx > 0) return FLOW_KITCHEN_ONLY[idx - 1];
  return null;
}

/* ✅ Siguientes estados permitidos en pantalla de cocina */
function allowedNextKitchen(from: StatusSnake): StatusSnake[] {
  switch (from) {
    case 'placed': return ['kitchen_in_progress'];
    case 'kitchen_in_progress': return ['kitchen_done'];
    default: return [];
  }
}

/* --------------------------------------------
   Helpers de ítems/opciones (presentación)
--------------------------------------------- */
function getLineQty(l: any): number {
  return Number(l?.quantity ?? l?.qty ?? 1) || 1;
}
function getLineName(l: any): string {
  return String(l?.menuItemName ?? l?.name ?? l?.menuItem?.name ?? 'Ítem');
}
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

/* ---- Compat Kitchen <-> Checkout ---- */
function getDisplayType(o: OrderDoc): 'dine_in' | 'delivery' {
  const infoType = String(o?.orderInfo?.type || '').toLowerCase();
  if (infoType === 'delivery') return 'delivery';
  if (infoType === 'dine-in' || infoType === 'dine_in') return 'dine_in';
  if (o.type === 'delivery') return 'delivery';
  if (o.type === 'dine_in') return 'dine_in';
  if (o.deliveryAddress) return 'delivery';
  return 'dine_in';
}
function getDisplayTable(o: OrderDoc): string | null {
  const t = o?.orderInfo?.table;
  if (t) return String(t);
  return o.tableNumber ?? null;
}
function getDisplayNotes(o: OrderDoc): string | null {
  const n = o?.orderInfo?.notes;
  if (n) return String(n);
  return o.notes ?? null;
}

/* --------------------------------------------
   🔴 resaltar líneas agregadas
--------------------------------------------- */
function tsMs(x: any): number {
  if (!x) return 0;
  try {
    if (typeof x.toDate === 'function') return x.toDate().getTime();
    if (typeof x.seconds === 'number') return x.seconds * 1000;
    const t = new Date(x).getTime();
    return Number.isFinite(t) ? t : 0;
  } catch { return 0; }
}
function isNewLine(order: OrderDoc, line: any, idx: number): boolean {
  const addedAt = tsMs(line?.addedAt);
  const reopenedAt = tsMs(order?.reopenedAt);
  if (addedAt && reopenedAt && addedAt >= reopenedAt) return true;
  if (order?.currentAppendBatchId && line?.addedBatchId && order.currentAppendBatchId === line.addedBatchId) return true;
  if (typeof order?.itemsCountBeforeAppend === 'number' && idx >= Number(order.itemsCountBeforeAppend)) return true;
  return false;
}

/* --------------------------------------------
   Hook de órdenes (solo cocina) — TENANT API
--------------------------------------------- */
const STATUS_QUERY = ['placed', 'kitchen_in_progress'].join(',');
const TYPE_QUERY = ['dine_in', 'delivery'].join(',');

function useKitchenOrders(
  enabled: boolean,
  pollMs = 4000,
  apiBase: string,
  onChange?: (prev: Map<string, string>, next: Map<string, string>) => void
) {
  const [orders, setOrders] = useState<OrderDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<any>(null);

  const prevMapRef = useRef<Map<string, string>>(new Map());

  const fetchNow = async () => {
    try {
      setError(null);
      if (!enabled) {
        setLoading(false);
        return;
      }
      const token = await getIdTokenSafe(false);
      if (!token) {
        setLoading(false);
        setError('ERR_NOT_LOGGED_IN');
        return;
      }
      const url = `${apiBase}/orders?statusIn=${encodeURIComponent(STATUS_QUERY)}&typeIn=${encodeURIComponent(TYPE_QUERY)}&limit=100`;
      const res = await apiFetch(url);
      if (res.status === 401) throw new Error('ERR_UNAUTHORIZED');
      if (!res.ok) throw new Error(`ERR_API_${res.status}`);

      const data = await res.json();
      const rawList = (data.items ?? data.orders ?? []) as any[];
      if (!Array.isArray(rawList)) {
        console.error('Unexpected format in GET /orders:', data);
        setOrders([]);
        setLoading(false);
        setError('ERR_UNEXPECTED');
        return;
      }

      const listRaw: OrderDoc[] = rawList.map((d) => {
        const normalizedStatus = toSnakeStatus(String(d.status || 'placed'));
        return { ...d, status: normalizedStatus } as OrderDoc;
      });

      const list = listRaw.filter(o => o.status === 'placed' || o.status === 'kitchen_in_progress');

      setOrders(list);
      setLoading(false);

      const nextMap = new Map<string, string>(list.map((o) => [o.id, o.status]));
      if (onChange) onChange(prevMapRef.current, nextMap);
      prevMapRef.current = nextMap;

    } catch (e: any) {
      setError(e?.message || 'ERR_LOADING');
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNow();
    return () => timer.current && clearInterval(timer.current);
  }, [enabled, apiBase]);

  useEffect(() => {
    if (!enabled) return;
    timer.current = setInterval(fetchNow, pollMs);
    return () => timer.current && clearInterval(timer.current);
  }, [enabled, pollMs, apiBase]);

  return { orders, loading, error, refresh: fetchNow } as const;
}

/* --------------------------------------------
   Sonido
--------------------------------------------- */
function useBeep(enabled: boolean) {
  const ctxRef = useRef<AudioContext | null>(null);
  useEffect(() => {
    if (!enabled) return;
    if (!ctxRef.current) ctxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
  }, [enabled]);
  const beep = async (durationMs = 160) => {
    if (!enabled) return;
    try {
      const ctx = ctxRef.current ?? new (window.AudioContext || (window as any).webkitAudioContext)();
      ctxRef.current = ctx;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = 880;
      o.connect(g);
      g.connect(ctx.destination);
      o.start();
      g.gain.setValueAtTime(0.15, ctx.currentTime);
      o.stop(ctx.currentTime + durationMs / 1000 + 0.01);
    } catch {}
  };
  return beep;
}

/* --------------------------------------------
   Acciones de status (solo cocina) — TENANT API
--------------------------------------------- */
function nextActionsKitchen(order: OrderDoc, canAct: boolean) {
  const acts: Array<{ label: string; to: StatusSnake; show: boolean }> = [];
  if (order.status === 'placed') acts.push({ label: 'START_KITCHEN', to: 'kitchen_in_progress', show: canAct });
  if (order.status === 'kitchen_in_progress') acts.push({ label: 'KITCHEN_READY', to: 'kitchen_done', show: canAct });
  return acts.filter((a) => a.show);
}
async function changeStatus(apiBase: string, orderId: string, to: StatusSnake) {
  const key = `${orderId}:${to}:${Date.now()}`;
  const res = await apiFetch(`${apiBase}/orders/${orderId}/status`, {
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

/* --------------------------------------------
   Fullscreen hook
--------------------------------------------- */
function useFullscreen() {
  const [isFs, setIsFs] = useState(false);
  useEffect(() => {
    const onChange = () => setIsFs(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);
  const enter = async () => {
    const el: any = document.documentElement;
    if (el.requestFullscreen) await el.requestFullscreen();
    else if (el.webkitRequestFullscreen) el.webkitRequestFullscreen();
    else if (el.msRequestFullscreen) el.msRequestFullscreen();
    setIsFs(true);
  };
  const exit = async () => {
    const d: any = document;
    if (d.exitFullscreen) await d.exitFullscreen();
    else if (d.webkitExitFullscreen) d.webkitExitFullscreen();
    else if (d.msExitFullscreen) d.msExitFullscreen();
    setIsFs(false);
  };
  const toggle = async () => (isFs ? exit() : enter());
  return { isFs, enter, exit, toggle } as const;
}

/* --------------------------------------------
   ⏱️ Cronómetros por orden (solo en memoria)
--------------------------------------------- */
type TimerInfo = { startAtMs: number; endAtMs?: number; running: boolean };
function formatDuration(ms: number) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}
const ALERT_RED_MS = 30_000;

/* --------------------------------------------
   UI: Badge y Tarjeta
--------------------------------------------- */
function BadgeStatus({ s, tt }: { s: StatusSnake; tt: (k: string, fb: string, v?: Record<string, unknown>) => string }) {
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

function OrderCard({
  o,
  canAct,
  onAction,
  busyKey,
  timer,
  nowMs,
  tt,
}: {
  o: OrderDoc;
  canAct: boolean;
  onAction: (id: string, to: StatusSnake) => Promise<void>;
  busyKey: string | null;
  timer?: TimerInfo | null;
  nowMs: number;
  tt: (k: string, fb: string, v?: Record<string, unknown>) => string;
}) {
  const created = toDate(o.createdAt ?? new Date());
  const isBusy = (to: StatusSnake) => busyKey === `${o.id}:${to}`;
  const nexts = nextActionsKitchen(o, canAct);

  const typeVal = getDisplayType(o);
  const tableVal = getDisplayTable(o);
  const notesVal = getDisplayNotes(o);
  const rawType = o?.orderInfo?.type?.toLowerCase?.();

  let elapsedLabel: string | null = null;
  let isElapsedAlert = false;
  if (timer?.startAtMs) {
    const end = timer.running ? nowMs : (timer.endAtMs ?? nowMs);
    const elapsedMs = end - timer.startAtMs;
    elapsedLabel = `⏱ ${formatDuration(elapsedMs)}`;
    isElapsedAlert = elapsedMs >= ALERT_RED_MS;
  }

  const translateGroupLabel = (label: string) => {
    const L = label.toLowerCase();
    if (L === 'options' || L === 'opciones') return tt('admin.kitchen.group.options', 'Options');
    if (L === 'addons') return tt('admin.kitchen.group.addons', 'Addons');
    if (L === 'extras') return tt('admin.kitchen.group.extras', 'Extras');
    if (L === 'modifiers') return tt('admin.kitchen.group.modifiers', 'Modifiers');
    if (L === 'group items') return tt('admin.kitchen.group.groupItems', 'Group items');
    return label;
  };

  const actionLabel = (to: StatusSnake) => {
    if (to === 'kitchen_in_progress') return tt('admin.kitchen.act.start', 'Start Kitchen');
    if (to === 'kitchen_done') return tt('admin.kitchen.act.ready', 'Kitchen ready');
    return String(to);
  };

  return (
    <div className="card shadow-sm">
      <div className="card-header d-flex align-items-center justify-content-between flex-wrap">
        <div className="d-flex flex-column">
          <div className="fw-semibold">#{o.orderNumber || o.id}</div>
          {typeVal === 'dine_in' && tableVal && <div className="fw-semibold">{tt('admin.kitchen.table', 'Table')} {tableVal}</div>}
          <small className="text-muted">
            {created.toLocaleString()} · {timeAgo(created, new Date(), tt)}
          </small>
        </div>
        <div className="d-flex gap-2 align-items-center w-100 justify-content-end mt-2">
          {elapsedLabel && (
            <span className={`badge ${isElapsedAlert ? 'bg-danger' : 'bg-dark-subtle text-dark'}`}>{elapsedLabel}</span>
          )}
          <span className="badge bg-outline-secondary text-dark">{typeVal}</span>
          {rawType === 'pickup' && <span className="badge bg-info text-dark">{tt('admin.kitchen.pickup', 'Pickup')}</span>}
          <BadgeStatus s={o.status} tt={tt} />
        </div>
      </div>

      <div className="card-body">
        {notesVal ? (
          <div className="mb-2">
            <em>{tt('admin.kitchen.note', 'Note')}: {notesVal}</em>
          </div>
        ) : null}

        {o.modifiedNote ? (
          <div className="mb-2">
            <em className="text-danger">{tt('admin.kitchen.modifiedNote', 'Modified note')}: {o.modifiedNote}</em>
          </div>
        ) : null}

        <div className="mb-2">
          {(o.items?.length ? o.items : o.lines || []).map((it: any, idx: number) => {
            const groups = normalizeOptions(it);
            const isNew = isNewLine(o, it, idx);
            return (
              <div key={idx} className={`small mb-1 ${isNew ? 'text-danger' : ''}`}>
                • {getLineQty(it)} × {getLineName(it)}
                {!!groups.length && (
                  <div className={`ms-3 ${isNew ? 'text-danger' : 'text-muted'}`}>
                    {groups.map((g, ix) => (
                      <div key={ix}>
                        <span className="fw-semibold">{translateGroupLabel(g.label)}:</span>{' '}
                        <span>{g.values.join(', ')}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="d-flex justify-content-end align-items-center">
          <div className="btn-group">
            {nexts.map((a) => {
              const label = actionLabel(a.to);
              return (
                <button
                  key={a.to}
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={isBusy(a.to)}
                  onClick={() => onAction(o.id, a.to)}
                  title={label}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------
   Página /admin/kitchen (TENANT)
--------------------------------------------- */
function KitchenBoardPage_Inner() {
  const apiBase = useApiBase();

  // 🔹 tenantId desde la URL (para resolver claims por-tenant)
  const params = useParams();
  const tenantId = String((params as any)?.tenantId ?? (params as any)?.tenant ?? '').trim();

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

  const { loading: authLoading, user, flags } = useAuth();
  const isKitchen = flags.isKitchen;
  const isAdmin   = flags.isAdmin;
  const authReady = !authLoading;

  // ➕ Normalizador local (soporta {roles:{...}} o forma plana)
  const normalizeTenantNode = React.useCallback((node: any): Record<string, any> => {
    if (!node) return {};
    if (node.roles && typeof node.roles === 'object') return { ...node.roles };
    return { ...node };
  }, []);

  // 🔸 Fallback: leer claims crudos del ID token para detectar admin por-tenant
  const [claimsLocal, setClaimsLocal] = useState<any | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!user) { setClaimsLocal(null); return; }
      const r = await getIdTokenResultSafe();
      if (!alive) return;
      setClaimsLocal(r?.claims || null);
    })();
    return () => { alive = false; };
  }, [user]);

  const tenantFlags = useMemo(() => {
    const node = claimsLocal?.tenants?.[tenantId];
    return normalizeTenantNode(node);
  }, [claimsLocal, tenantId, normalizeTenantNode]);

  // ✅ permite actuar si:
  // - el provider ya marcó isKitchen
  // - o es admin (global o por-tenant)
  // - o el token por-tenant indica kitchen
  const canAct = (
    isKitchen ||
    isAdmin ||
    !!tenantFlags.admin ||
    !!tenantFlags.kitchen
  );
  
  const [soundOn, setSoundOn] = useState(true);
  const beep = useBeep(soundOn);
  const onOrdersChange = async (prev: Map<string, string>, next: Map<string, string>) => {
    for (const [id, status] of next.entries()) {
      const prevStatus = prev.get(id);
      if (prevStatus && prevStatus !== status) {
        await beep();
        break;
      }
    }
  };

  const { orders, loading, error, refresh } = useKitchenOrders(!!user, 4000, apiBase, onOrdersChange);

  const timersRef = useRef<Record<string, TimerInfo>>({});
  const [tick, setTick] = useState(0);
  const [nowMs, setNowMs] = useState<number>(Date.now());

  useEffect(() => {
    const id = setInterval(() => {
      setNowMs(Date.now());
      setTick((v) => v + 1);
    }, 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const visible = new Set(orders.map(o => o.id));
    let changed = false;
    for (const k of Object.keys(timersRef.current)) {
      if (!visible.has(k)) {
        delete timersRef.current[k];
        changed = true;
      }
    }
    if (changed) setTick(v => v + 1);
  }, [orders]);

  const startTimer = (orderId: string) => {
    timersRef.current[orderId] = { startAtMs: Date.now(), running: true };
    setTick((v) => v + 1);
  };
  const stopTimer = (orderId: string) => {
    const t = timersRef.current[orderId];
    if (t) {
      timersRef.current[orderId] = { ...t, endAtMs: Date.now(), running: false };
      setTick((v) => v + 1);
    }
  };
  const clearTimer = (orderId: string) => {
    if (timersRef.current[orderId]) {
      delete timersRef.current[orderId];
      setTick((v) => v + 1);
    }
  };

  const [busy, setBusy] = useState<string | null>(null);
  const doAct = async (id: string, to: StatusSnake) => {
    const prevSnapshot = timersRef.current[id] ? { ...timersRef.current[id] } : undefined;
    if (to === 'kitchen_in_progress') startTimer(id);
    if (to === 'kitchen_done') stopTimer(id);

    try {
      const order = orders.find((o) => o.id === id);
      if (!order) throw new Error(tt('admin.kitchen.err.notFound', 'Order not found'));

      const allowed = allowedNextKitchen(order.status);
      const prev = getPrevKitchen(order);
      const isRevert = prev === to;
      if (!isRevert && !allowed.includes(to)) {
        alert(tt('admin.kitchen.err.transitionNotAllowed', 'Transition not allowed from "{from}" to "{to}".', {
          from: translate(lang, statusKey(order.status)),
          to: translate(lang, statusKey(to)),
        }));
        if (to === 'kitchen_in_progress' && prevSnapshot) timersRef.current[id] = prevSnapshot;
        if (to === 'kitchen_done' && prevSnapshot) timersRef.current[id] = prevSnapshot;
        if (!prevSnapshot) clearTimer(id);
        setTick(v => v + 1);
        return;
      }

      setBusy(`${id}:${to}`);
      await changeStatus(apiBase, id, to);
      await refresh();
    } catch (e: any) {
      if (prevSnapshot) {
        timersRef.current[id] = prevSnapshot;
      } else {
        clearTimer(id);
      }
      alert(e?.message || tt('admin.kitchen.err.generic', 'Error'));
    } finally {
      setBusy(null);
    }
  };

  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return orders.filter((o) => {
      if (!term) return true;
      const type = getDisplayType(o);
      const table = getDisplayTable(o) ?? '';
      const notes = getDisplayNotes(o) ?? '';
      const hay = [
        o.orderNumber, o.id, table, notes, type,
        ...(o.items?.map((i) => i.menuItemName) || []),
      ].join(' ').toLowerCase();
      return hay.includes(term);
    });
  }, [orders, q]);

  const dineIn = filtered
    .filter((o) => getDisplayType(o) === 'dine_in')
    .slice()
    .sort(byCreatedAtDesc);

  const delivery = filtered
    .filter((o) => getDisplayType(o) === 'delivery')
    .slice()
    .sort(byCreatedAtDesc);

  const { isFs, toggle: toggleFs } = useFullscreen();

  const errorText = error
    ? (() => {
        if (error === 'ERR_NOT_LOGGED_IN') return tt('admin.kitchen.err.notLogged', 'You must log in to view orders.');
        if (error === 'ERR_UNAUTHORIZED') return tt('admin.kitchen.err.unauthorized', 'Unauthorized (401). Log in again.');
        if (error?.startsWith?.('ERR_API_')) return tt('admin.kitchen.err.api', 'Server error.');
        if (error === 'ERR_UNEXPECTED') return tt('admin.kitchen.err.unexpected', 'Unexpected server response.');
        if (error === 'ERR_LOADING') return tt('admin.kitchen.err.loading', 'Loading error');
        return error;
      })()
    : null;

  return (
    <div className="container py-3">
      <div
        className="d-flex align-items-center justify-content-between gap-3 mb-3 sticky-top bg-white py-2"
        style={{ top: 0, zIndex: 5, borderBottom: '1px solid #eee' }}
      >
        <div className="d-flex align-items-center gap-3">
          <h1 className="h4 m-0">{tt('admin.kitchen.title', 'Kitchen Display')}</h1>
          <span className="text-muted small d-none d-md-inline">
            {tt('admin.kitchen.subtitle', 'You will see orders in status: {a} & {b}.', {
              a: translate(lang, 'admin.kitchen.status.received', {}),
              b: translate(lang, 'admin.kitchen.status.inKitchen', {}),
            })}
          </span>
        </div>
        <div className="d-flex align-items-center gap-2">
          <div className="input-group input-group-sm" style={{ width: 260 }}>
            <span className="input-group-text">{tt('common.search', 'Search')}</span>
            <input
              type="search"
              className="form-control"
              placeholder={tt('admin.kitchen.searchPh', '#order, table, item, note')}
              value={q}
              onChange={(e) => setQ(e.target.value)}
            />
          </div>
          <button className="btn btn-outline-secondary btn-sm" onClick={() => refresh()}>
            {tt('common.refresh', 'Refresh')}
          </button>
          <div className="form-check form-switch">
            <input className="form-check-input" type="checkbox" id="soundSwitch" checked={soundOn} onChange={(e) => setSoundOn(e.target.checked)} />
            <label className="form-check-label small" htmlFor="soundSwitch">{tt('admin.kitchen.sound', 'Sound')}</label>
          </div>
          <button
            className="btn btn-outline-dark btn-sm"
            onClick={toggleFs}
            title={isFs ? tt('admin.kitchen.fullscreen.exitTitle', 'Exit full screen (Esc)') : tt('admin.kitchen.fullscreen.enterTitle', 'Full Screen')}
          >
            {isFs ? tt('admin.kitchen.fullscreen.exit', 'Exit full screen') : tt('admin.kitchen.fullscreen.enter', 'Full Screen')}
          </button>
        </div>
      </div>

      {!authReady && <div className="text-muted">{tt('admin.kitchen.init', 'Initializing session…')}</div>}
      {authReady && !user && <div className="text-danger">{tt('admin.kitchen.notLogged', 'You are not logged in. Sign in to view orders.')}</div>}
      {errorText && <div className="text-danger">{errorText}</div>}
      {user && loading && <div className="text-muted">{tt('admin.kitchen.loading', 'Loading orders…')}</div>}

      {user && (
        <section className="mb-4">
          <div className="d-flex align-items-center justify-content-between mb-2">
            <h2 className="h5 m-0">{tt('admin.kitchen.dinein', 'Dine-in')}</h2>
            <span className="badge bg-secondary">{dineIn.length}</span>
          </div>

          {dineIn.length === 0 ? (
            <div className="text-muted small">{tt('admin.kitchen.noDinein', 'No dine-in orders.')}</div>
          ) : (
            <div className="row g-3">
              {dineIn.map((o) => (
                <div key={o.id} className="col-12 col-md-6 col-lg-4">
                  <OrderCard
                    o={o}
                    canAct={canAct}
                    onAction={(id, to) => doAct(id, to)}
                    busyKey={busy}
                    timer={timersRef.current[o.id]}
                    nowMs={nowMs}
                    tt={tt}
                  />
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {user && (
        <section className="mt-4">
          <div className="d-flex align-items-center justify-content-between mb-2">
            <h2 className="h5 m-0">{tt('admin.kitchen.delivery', 'Delivery')}</h2>
            <span className="badge bg-secondary">{delivery.length}</span>
          </div>

          {delivery.length === 0 ? (
            <div className="text-muted small">{tt('admin.kitchen.noDelivery', 'No delivery orders.')}</div>
          ) : (
            <div className="row g-3">
              {delivery.map((o) => (
                <div key={o.id} className="col-12 col-md-6 col-lg-4">
                  <OrderCard
                    o={o}
                    canAct={canAct}
                    onAction={(id, to) => doAct(id, to)}
                    busyKey={busy}
                    timer={timersRef.current[o.id]}
                    nowMs={nowMs}
                    tt={tt}
                  />
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  );
}


export default function KitchenBoardPage() {
  return (
    <Protected>
      <OnlyKitchen>
        <ToolGate feature="kitchen">      
          <KitchenBoardPage_Inner />
        </ToolGate>
      </OnlyKitchen>
    </Protected>
    
  );
}
