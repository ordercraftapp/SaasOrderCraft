// src/app/(tenant)/[tenantId]/app/(client)/app/tracking/page.tsx
"use client";

import React, { useEffect, useRef, useState } from "react";
import Protected from "@/app/(tenant)/[tenantId]/components/Protected";
import { useTenantSettings } from "@/lib/settings/hooks";
import { t, getLang } from "@/lib/i18n/t";
import { useParams } from "next/navigation";

/* === Firebase auth helpers (igual que tu versión) === */
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
  const app = await import("firebase/app");
  if (!app.getApps().length) {
    const cfg = getFirebaseClientConfig();
    if (cfg.apiKey && cfg.authDomain && cfg.projectId && cfg.appId) {
      app.initializeApp(cfg);
    } else {
      console.warn("[Firebase] Missing public configuration; Auth is not able to initialize.");
    }
  }
}
async function getAuthMod() {
  await ensureFirebaseApp();
  return await import("firebase/auth");
}
function useAuthState() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<any | null>(null);
  useEffect(() => {
    let mounted = true;
    (async () => {
      const { getAuth, onAuthStateChanged } = await getAuthMod();
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

/* API fetch con reintento 401 */
async function apiFetch(path: string, init?: RequestInit) {
  let token = await getIdTokenSafe(false);
  let headers: HeadersInit = { ...(init?.headers || {}) };
  if (token) (headers as any)["Authorization"] = `Bearer ${token}`;
  let res = await fetch(path, { ...init, headers });

  if (res.status === 401) {
    token = await getIdTokenSafe(true);
    headers = { ...(init?.headers || {}) };
    if (token) (headers as any)["Authorization"] = `Bearer ${token}`;
    res = await fetch(path, { ...init, headers });
  }
  return res;
}

/* Tipos (idénticos) */
type StatusSnake =
  | "cart" | "placed" | "kitchen_in_progress" | "kitchen_done" | "ready_to_close"
  | "assigned_to_courier" | "on_the_way" | "delivered" | "closed" | "cancelled";

type OrderItemLine = {
  menuItemName?: string; name?: string; quantity?: number;
  optionGroups?: Array<{ groupId?: string; groupName?: string; type?: "single" | "multiple"; items: Array<{ id?: string; name?: string; priceDelta?: number }> }>;
  options?: Array<{ groupName: string; selected: Array<{ name: string; priceDelta?: number }> }>;
  addons?: Array<string | { name: string; priceDelta?: number }>;
  extras?: Array<string | { name: string; priceDelta?: number }>;
  modifiers?: Array<string | { name: string; priceDelta?: number }>;
  groupItems?: Array<string | { name: string }>;
};
type OrderDoc = {
  id: string;
  orderNumber?: string;
  type?: "dine_in" | "delivery";
  status: StatusSnake;
  items?: OrderItemLine[];
  lines?: OrderItemLine[];
  createdAt?: any;
  notes?: string | null;
  deliveryAddress?: string | null;
  orderInfo?: {
    type?: "dine-in" | "delivery";
    notes?: string; address?: string; phone?: string;
    delivery?: "pending" | "inroute" | "delivered"; courierName?: string | null;
  } | any;
};

/* i18n helpers (igual que tu versión) */
const TitleKeyMap: Record<StatusSnake, string> = {
  cart: "track.status.cart",
  placed: "track.status.received",
  kitchen_in_progress: "track.status.inKitchen",
  kitchen_done: "track.status.kitchenReady",
  ready_to_close: "track.status.readyToClose",
  assigned_to_courier: "track.status.assigned",
  on_the_way: "track.status.onTheWay",
  delivered: "track.status.delivered",
  closed: "track.status.closed",
  cancelled: "track.status.cancelled",
};
function toSnakeStatus(s: string): StatusSnake {
  if (!s) return "placed";
  const snake = s.includes("_") ? s : s.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
  const aliasMap: Record<string, StatusSnake> = {
    ready: "ready_to_close",
    served: "ready_to_close",
    completed: "closed",
    ready_for_delivery: "assigned_to_courier",
    out_for_delivery: "on_the_way",
  };
  return (aliasMap[snake] ?? (snake as StatusSnake)) as StatusSnake;
}
function getDisplayType(o: OrderDoc): "dine_in" | "delivery" {
  const infoType = String(o?.orderInfo?.type || "").toLowerCase();
  if (infoType === "delivery") return "delivery";
  if (infoType === "dine-in" || infoType === "dine_in") return "dine_in";
  if (o.type === "delivery") return "delivery";
  if (o.type === "dine_in") return "dine_in";
  if (o.deliveryAddress) return "delivery";
  return "dine_in";
}
const STATUS_QUERY_MAIN = [
  "placed","kitchen_in_progress","kitchen_done","ready_to_close","closed",
  "assigned_to_courier","on_the_way","delivered",
].join(",");
const TYPE_QUERY = ["delivery"].join(",");

/* ---- Multi-tenant: usamos el prefijo /{tenantId}/app/api/... ---- */
function useMyDeliveryOrders(tenantId: string | undefined, enabled: boolean, pollMs = 4000) {
  const [orders, setOrders] = useState<OrderDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<any>(null);

  const fetchNow = async () => {
    try {
      setError(null);
      if (!enabled || !tenantId) {
        setLoading(false);
        return;
      }
      const url = `/${tenantId}/app/api/orders?statusIn=${encodeURIComponent(
        STATUS_QUERY_MAIN
      )}&typeIn=${encodeURIComponent(TYPE_QUERY)}&limit=100`; // tenancyUpdate: endpoint namespaced por tenant

      const res = await apiFetch(url);
      if (res.status === 401) throw new Error("track.err.unauthorized");
      if (!res.ok) throw new Error(`GET /orders ${res.status}`);

      const data = await res.json();
      const rawList = (data.items ?? data.orders ?? []) as any[];
      const listRaw: OrderDoc[] = (rawList || []).map((d) => ({
        ...d,
        status: toSnakeStatus(String(d.status || "placed")),
      }));

      const list = listRaw
        .filter((o) => getDisplayType(o) === "delivery")
        .filter((o) => String(o?.orderInfo?.delivery || "pending") !== "delivered")
        .sort((a, b) => {
          const ta = a.createdAt?._seconds ? a.createdAt._seconds * 1000 : a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const tb = b.createdAt?._seconds ? b.createdAt._seconds * 1000 : b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return tb - ta;
        });

      setOrders(list);
      setLoading(false);
    } catch (e: any) {
      setError(e?.message || "track.err.loading");
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNow();
    return () => timer.current && clearInterval(timer.current);
  }, [tenantId, enabled]); // tenancyUpdate

  useEffect(() => {
    if (!enabled) return;
    timer.current = setInterval(fetchNow, pollMs);
    return () => timer.current && clearInterval(timer.current);
  }, [enabled, pollMs]);

  return { orders, loading, error, refresh: fetchNow } as const;
}

/* Timeline y componentes de UI (sin cambios relevantes) */
type TimelineStepKey =
  | "placed" | "kitchen_in_progress" | "kitchen_done"
  | "assigned_to_courier_visual" | "inroute" | "delivered";
const STEP_LABEL_KEYS: Record<TimelineStepKey, string> = {
  placed: "track.step.received",
  kitchen_in_progress: "track.step.inKitchen",
  kitchen_done: "track.step.kitchenReady",
  assigned_to_courier_visual: "track.step.assigned",
  inroute: "track.step.onTheWay",
  delivered: "track.step.delivered",
};
function getStepState(order: OrderDoc) {
  const courierName = order?.orderInfo?.courierName ?? null;
  const sub: "pending" | "inroute" | "delivered" = order?.orderInfo?.delivery ?? "pending";
  const steps = [
    { key: "placed", labelKey: STEP_LABEL_KEYS.placed },
    { key: "kitchen_in_progress", labelKey: STEP_LABEL_KEYS.kitchen_in_progress },
    { key: "kitchen_done", labelKey: STEP_LABEL_KEYS.kitchen_done },
    { key: "assigned_to_courier_visual", labelKey: STEP_LABEL_KEYS.assigned_to_courier_visual },
    { key: "inroute", labelKey: STEP_LABEL_KEYS.inroute },
    { key: "delivered", labelKey: STEP_LABEL_KEYS.delivered },
  ] as const;
  let idx = 0;
  const main = order.status;
  if (main === "kitchen_in_progress") idx = 1;
  else if (main === "kitchen_done") idx = 2;
  else if (["ready_to_close","assigned_to_courier","on_the_way","closed","delivered"].includes(main)) idx = 2;
  if (courierName && idx < 3) idx = 3;
  if (sub === "inroute" && idx < 4) idx = 4;
  if (sub === "delivered") idx = 5;
  return { steps: steps as any, activeIndex: idx };
}
function StepIcon({ name }: { name: TimelineStepKey }) {
  const map: Record<TimelineStepKey, string> = {
    placed: "🧾", kitchen_in_progress: "🍳", kitchen_done: "✅",
    assigned_to_courier_visual: "🆔", inroute: "🛵", delivered: "🏠",
  };
  return <span aria-hidden="true" style={{ fontSize: 18, lineHeight: 1 }}>{map[name] ?? "•"}</span>;
}
function VerticalTimeline({
  steps, activeIndex, lang,
}: { steps: Array<{ key: TimelineStepKey; labelKey: string }>; activeIndex: number; lang: string }) {
  return (
    <div className="vtl">
      {steps.map((s, i) => {
        const state = i < activeIndex ? "done" : i === activeIndex ? "active" : "todo";
        const label = t(lang, s.labelKey);
        const ariaSuffix =
          state === "active" ? t(lang, "track.a11y.current") :
          state === "done" ? t(lang, "track.a11y.completed") : "";
        return (
          <div className="vtl-row" key={s.key}>
            <div className="vtl-marker">
              <div className={`vtl-dot ${state === "done" ? "vtl-done" : state === "active" ? "vtl-active" : "vtl-todo"}`}
                   aria-label={`${label}${ariaSuffix ? ` (${ariaSuffix})` : ""}`}>
                <StepIcon name={s.key} />
              </div>
              {i < steps.length - 1 && <div className="vtl-line" aria-hidden="true" />}
            </div>
            <div className="vtl-label">
              <div className={`vtl-text ${state === "todo" ? "text-muted" : ""}`}>{label}</div>
            </div>
          </div>
        );
      })}
      <style jsx>{`
        .vtl { display: grid; row-gap: 12px; padding-left: 2px; }
        .vtl-row { display: grid; grid-template-columns: 28px 1fr; column-gap: 10px; align-items: start; }
        .vtl-marker { position: relative; display: flex; flex-direction: column; align-items: center; }
        .vtl-dot { display: grid; place-items: center; width: 28px; height: 28px; border-radius: 50%; border: 1px solid #e5e5e5; background: #f8f9fa; }
        .vtl-active { background: #0d6efd; color: #fff; border-color: #0d6efd; }
        .vtl-done { background: #198754; color: #fff; border-color: #198754; }
        .vtl-line { width: 2px; flex: 1 1 auto; background: #e9ecef; margin-top: 6px; margin-bottom: -6px; }
        .vtl-label { padding-top: 4px; }
        .vtl-text { font-size: 14px; }
        @media (max-width: 576px) { .vtl-text { font-size: 13px; } }
      `}</style>
    </div>
  );
}
function OrderTrackingCard({ o, lang }: { o: OrderDoc; lang: string }) {
  const address = o?.orderInfo?.address ?? o.deliveryAddress ?? null;
  const phone = o?.orderInfo?.phone ?? null;
  const notes = o?.orderInfo?.notes ?? o.notes ?? null;
  const courierName: string | null = o?.orderInfo?.courierName ?? null;
  const { steps, activeIndex } = getStepState(o);
  const lines = (o.items?.length ? o.items : o.lines || []);
  const statusLabel = t(lang, TitleKeyMap[o.status]);

  return (
    <div className="card shadow-sm">
      <div className="card-body">
        <div className="d-flex flex-wrap align-items-center justify-content-between gap-2 mb-2">
          <div className="d-flex align-items-center gap-2">
            <span className="badge bg-dark-subtle text-dark">{t(lang, "track.badge.delivery")}</span>
            <div className="fw-semibold">#{o.orderNumber || o.id}</div>
          </div>
          <span className="badge bg-secondary">{statusLabel}</span>
        </div>
        <div className="row g-2 small mb-3">
          <div className="col-12 col-sm-6">
            <span className="fw-semibold">{t(lang, "track.field.address")}:</span>{" "}
            {address || <em className="text-muted">—</em>}
          </div>
          <div className="col-6 col-sm-3">
            <span className="fw-semibold">{t(lang, "track.field.phone")}:</span>{" "}
            {phone || <em className="text-muted">—</em>}
          </div>
          <div className="col-6 col-sm-3">
            <span className="fw-semibold">{t(lang, "track.field.courier")}:</span>{" "}
            {courierName ? courierName : <em className="text-muted">—</em>}
          </div>
          {notes ? (
            <div className="col-12">
              <span className="fw-semibold">{t(lang, "track.field.notes")}:</span> {notes}
            </div>
          ) : null}
        </div>
        <VerticalTimeline steps={steps as any} activeIndex={activeIndex} lang={lang} />
        <div className="mt-3">
          <div className="fw-semibold mb-1">{t(lang, "track.yourOrder")}</div>
          <div className="small">
            {(lines || []).map((it, idx) => (
              <div key={idx} className="mb-1">
                • {(Number((it as any)?.quantity ?? 1) || 1)} ×{" "}
                {String((it as any)?.menuItemName ?? (it as any)?.name ?? (it as any)?.menuItem?.name ?? t(lang, "track.item"))}
              </div>
            ))}
          </div>
        </div>
      </div>
      <style jsx>{`.card { border-radius: 12px; } @media (max-width: 576px) { .card-body { padding: 14px; } }`}</style>
    </div>
  );
}

/* Página Tracking (multi-tenant) */
function TrackingPageInner() {
  const { tenantId } = useParams<{ tenantId: string }>(); // tenancyUpdate: unificamos el nombre del segmento
  const { authReady, user } = useAuthState();
  const { settings } = useTenantSettings();
  const rawLang =
    (settings as any)?.language ??
    (typeof window !== "undefined" ? localStorage.getItem("tenant.language") || undefined : undefined);
  const lang = getLang(rawLang);

  const { orders, loading, error, refresh } = useMyDeliveryOrders(tenantId, !!user, 4000); // tenancyUpdate

  return (
    <div className="container py-3">
      <div className="d-flex align-items-center justify-content-between gap-2 mb-3" style={{ borderBottom: "1px solid #eee" }}>
        <div className="d-flex flex-column">
          <h1 className="h5 m-0">{t(lang, "track.title")}</h1>
          <small className="text-muted">
            {t(lang, "track.subtitle.prefix")} <strong>{t(lang, "track.status.delivered")}</strong>.
          </small>
        </div>
        <button className="btn btn-outline-secondary btn-sm" onClick={() => refresh()}>
          {t(lang, "common.refresh")}
        </button>
      </div>

      {!authReady && <div className="text-muted">{t(lang, "track.initSession")}</div>}
      {authReady && !user && <div className="text-danger">{t(lang, "track.signInPrompt")}</div>}
      {error && <div className="text-danger">{t(lang, error)}</div>}
      {user && loading && <div className="text-muted">{t(lang, "track.loadingOrders")}</div>}

      {user && (
        <>
          {orders.length === 0 ? (
            <div className="alert alert-light">{t(lang, "track.noDeliveries")}</div>
          ) : (
            <div className="row g-3">
              {orders.map((o) => (
                <div key={o.id} className="col-12 col-md-6 col-lg-5 col-xl-4">
                  <OrderTrackingCard o={o} lang={lang} />
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function TrackingPage() {
  return (
    <Protected>
      <TrackingPageInner />
    </Protected>
  );
}
