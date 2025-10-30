// src/app/(tenant)/[tenantId]/app/admin/layout.tsx
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';

/* 🔤 i18n */
import { t as translate } from '@/lib/i18n/t';
import { useTenantSettings } from '@/lib/settings/hooks';

/* 🗝️ Plan features (visibilidad de tools) */
import { useFeature } from '@/lib/plans/client';

/* ✅ Tenant context (Checklist #1) */
import { TenantProvider } from '@/lib/tenant/context';

/* ✅ Settings provider (envuelve el layout) */
import { SettingsProvider } from '@/lib/settings/context';

/* ===== Autenticación para fetch con idToken (igual que en otras páginas) ===== */
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

/* ============================
   🔹 Tenant helpers (path o subdominio)
   ============================ */
function getTenantIdFromLocation(): string | null {
  try {
    if (typeof window === 'undefined') return null;

    const pathname = window.location.pathname || '/';
    const parts = pathname.split('/').filter(Boolean);

    // 1) /{tenantId}/app/...
    if (parts.length >= 2 && parts[1] === 'app') {
      return parts[0] || null;
    }
    // 2) /_t/{tenantId}/app/...
    if (parts.length >= 3 && parts[0] === '_t' && parts[2] === 'app') {
      return parts[1] || null;
    }

    // 3) Subdominio: {tenantId}.example.com -> /app/...
    const host = window.location.hostname || '';
    const labels = host.split('.').filter(Boolean);
    if (labels.length >= 3) {
      const sub = labels[0];
      if (sub && sub !== 'www') return sub;
    }

    return null;
  } catch {
    return null;
  }
}

/** Devuelve una URL absoluta same-origin corrigiendo a /{tenantId}/app/... */
function makeTenantUrl(path: string): string {
  const tenantId = getTenantIdFromLocation();
  const rel = path.startsWith('/') ? path : `/${path}`;

  if (tenantId && (rel === `/${tenantId}` || rel.startsWith(`/${tenantId}/`))) {
    return new URL(rel, window.location.origin).toString();
  }
  if (tenantId && rel.startsWith('/api/')) {
    return new URL(`/${tenantId}/app${rel}`, window.location.origin).toString();
  }
  if (tenantId && rel.startsWith('/app/')) {
    return new URL(`/${tenantId}${rel}`, window.location.origin).toString();
  }
  if (tenantId) {
    return new URL(`/${tenantId}${rel}`, window.location.origin).toString();
  }
  return new URL(rel, window.location.origin).toString();
}

/** Para <Link/> dentro del layout */
function tenantHref(path: string): string {
  const tenantId = getTenantIdFromLocation();
  const rel = path.startsWith('/') ? path : `/${path}`;
  if (tenantId && rel.startsWith('/app/')) return `/${tenantId}${rel}`;
  if (tenantId && rel.startsWith('/api/')) return `/${tenantId}/app${rel}`;
  if (tenantId && !rel.startsWith(`/${tenantId}/`)) return `/${tenantId}${rel}`;
  return rel;
}

async function apiFetch(path: string, init?: RequestInit) {
  let token = await getIdTokenSafe(false);
  let headers: HeadersInit = { ...(init?.headers || {}) };
  if (token) (headers as any)['Authorization'] = `Bearer ${token}`;

  const url = typeof window !== 'undefined' ? makeTenantUrl(path) : path;

  let res = await fetch(url, { ...init, headers, cache: 'no-store' });
  if (res.status === 401) {
    token = await getIdTokenSafe(true);
    headers = { ...(init?.headers || {}) };
    if (token) (headers as any)['Authorization'] = `Bearer ${token}`;
    res = await fetch(url, { ...init, headers, cache: 'no-store' });
  }
  return res;
}

/* ===== Tipos y hook de contadores ===== */
type NavCounts = {
  kitchenPending: number;
  cashierQueue: number;
  deliveryPending: number;
};

function useNavCounts(pollMs = 15000) {
  const [counts, setCounts] = useState<NavCounts | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    try {
      const maybeToken = await getIdTokenSafe(false);
      if (!maybeToken) {
        setLoading(false);
        return;
      }
      setErr(null);
      setLoading(true);

      let res = await apiFetch('/api/admin/nav-counts');

      if (res.status === 403) {
        await getIdTokenSafe(true);
        res = await apiFetch('/api/admin/nav-counts');
      }

      const data = await res.json().catch(() => ({} as any));
      if (!res.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${res.status}`);

      setCounts({
        kitchenPending: Number(data.kitchenPending || 0),
        cashierQueue: Number(data.cashierQueue || 0),
        deliveryPending: Number(data.deliveryPending || 0),
      });
    } catch (e: any) {
      setErr(e?.message || 'No se pudieron cargar los contadores');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!alive) return;
      await load();
      if (!alive) return;
      const id = setInterval(load, pollMs);
      return () => clearInterval(id);
    })();
  }, [pollMs]);

  return { counts, err, loading, reload: load } as const;
}

/* ======= Mesas activas ======= */
function useActiveTablesCount(pollMs = 15000) {
  const [count, setCount] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const OPEN_STATUSES = ['placed','kitchen_in_progress','kitchen_done','ready_to_close'] as const;

  const load = async () => {
    try {
      setLoading(true);
      await ensureFirebaseApp();
      const { getFirestore, collection, query, where, getDocs, limit } = await import('firebase/firestore');
      const db = getFirestore();

      const tenantId = getTenantIdFromLocation();

      const qRef = tenantId
        ? query(
            collection(db, 'tenants', tenantId, 'orders'),
            where('orderInfo.type', '==', 'dine-in'),
            where('status', 'in', OPEN_STATUSES as unknown as string[]),
            limit(1000)
          )
        : query(
            collection(db, 'orders'),
            where('orderInfo.type', '==', 'dine-in'),
            where('status', 'in', OPEN_STATUSES as unknown as string[]),
            limit(1000)
          );

      const snap = await getDocs(qRef);
      const tables = new Set<string>();
      snap.forEach(doc => {
        const data: any = doc.data();
        const t = String(data?.orderInfo?.table ?? '').trim();
        if (t) tables.add(t);
      });
      setCount(tables.size);
    } catch {
      setCount(0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!alive) return;
      await load();
      if (!alive) return;
      const id = setInterval(load, pollMs);
      return () => clearInterval(id);
    })();
    return () => { alive = false; };
  }, [pollMs]);

  return { count, loading, reload: load } as const;
}

/* 🆕 Helper: construir URL de upgrade en el SITE con tenantId + orderId */
function buildUpgradeHref(tenantId: string, orderId: string | null) {
  const base = (process.env.NEXT_PUBLIC_BASE_DOMAIN || 'datacraftcoders.cloud').toLowerCase();
  const url = new URL(`https://${base}/upgrade`);
  url.searchParams.set('tenantId', tenantId);
  if (orderId) url.searchParams.set('orderId', orderId);
  return url.toString();
}

/* 🆕 Hook: obtener el último orderId del tenant (tenantOrders) */
function useLatestOrderId(tenantId: string | null) {
  const [orderId, setOrderId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      if (!tenantId) return;
      try {
        await ensureFirebaseApp();
        const { getFirestore, collection, query, orderBy, limit, getDocs } = await import('firebase/firestore');
        const db = getFirestore();
        // Última orden (created/provisioned si quieres filtrar por estado, aquí tomamos la más reciente)
        const q = query(
          collection(db, 'tenants', tenantId, 'tenantOrders'),
          orderBy('createdAt', 'desc'),
          limit(1)
        );
        const snap = await getDocs(q);
        if (!alive) return;
        if (!snap.empty) {
          setOrderId(snap.docs[0].id);
        } else {
          setOrderId(null);
        }
      } catch {
        if (alive) setOrderId(null);
      }
    })();
    return () => { alive = false; };
  }, [tenantId]);

  return orderId;
}

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  const tenantId = (() => {
    try {
      const parts = (pathname || '/').split('/').filter(Boolean);
      if (parts.length >= 2 && parts[1] === 'app') return parts[0];
      if (parts.length >= 3 && parts[0] === '_t' && parts[2] === 'app') return parts[1];
      if (typeof window !== 'undefined') {
        const host = window.location.hostname || '';
        const labels = host.split('.').filter(Boolean);
        if (labels.length >= 3 && labels[0] !== 'www') return labels[0];
      }
      return null;
    } catch { return null; }
  })();

  const latestOrderId = useLatestOrderId(tenantId);
  const upgradeHref = useMemo(
    () => (tenantId ? buildUpgradeHref(tenantId, latestOrderId) : null),
    [tenantId, latestOrderId]
  );

  const isActive = (href: string) => {
    const full = tenantHref(href);
    return pathname?.startsWith(full);
  };

  const { counts, loading } = useNavCounts(15000);
  const { count: activeTables, loading: loadingTables } = useActiveTablesCount(15000);

  const kitch = counts?.kitchenPending ?? 0;
  const cashq = counts?.cashierQueue ?? 0;
  const deliv = counts?.deliveryPending ?? 0;

  /* 🔤 idioma actual + helper (anti hydration mismatch) 
  const { settings } = useTenantSettings();
  const [lang, setLang] = useState<string | undefined>(() => (settings as any)?.language);
  useEffect(() => {
    try {
      const ls = localStorage.getItem('tenant.language');
      setLang(ls || (settings as any)?.language);
    } catch {
      setLang((settings as any)?.language);
    }
  }, [settings]);
  const tt = (key: string, fallback: string, vars?: Record<string, unknown>) => {
    const s = translate(lang, key, vars);
    return s === key ? fallback : s;
  };*/
  const { settings } = useTenantSettings();
    const lang = useMemo(() => {
      try {
        if (typeof window !== 'undefined') {
          const ls = localStorage.getItem('tenant.language');
          if (ls) return ls;
        }
      } catch {}
      return (settings as any)?.language;
    }, [settings]);
    const tt = (key: string, fallback: string, vars?: Record<string, unknown>) => {
      const s = translate(lang, key, vars);
      return s === key ? fallback : s;
    };

  /* ✅ Visibilidad de links según plan */
  const { allowed: kitchenAllowed }  = useFeature('kitchen');
  const { allowed: cashierAllowed }  = useFeature('cashier');
  const { allowed: deliveryAllowed } = useFeature('delivery');
  const { allowed: waiterAllowed }   = useFeature('waiter');

  return (
    <TenantProvider>
      <SettingsProvider>
        <nav className="navbar navbar-expand-md navbar-light bg-white border-bottom shadow-sm">
          <div className="container">
            <Link className="navbar-brand fw-semibold" href={tenantHref('/app/admin')}>
              {tt('admin.nav.brand', 'Admin Portal')}
            </Link>

            <button
              className="navbar-toggler"
              type="button"
              aria-label={tt('admin.nav.toggle', 'Toggle navigation')}
              aria-expanded={open ? 'true' : 'false'}
              onClick={() => setOpen((v) => !v)}
            >
              <span className="navbar-toggler-icon"></span>
            </button>

            <div className={`collapse navbar-collapse${open ? ' show' : ''}`}>
              <ul className="navbar-nav me-auto mb-2 mb-md-0">

                {kitchenAllowed && (
                  <li className="nav-item">
                    <Link
                      className={`nav-link d-flex align-items-center gap-2 ${isActive('/app/admin/kitchen') ? 'active' : ''}`}
                      href={tenantHref('/app/admin/kitchen')}
                    >
                      <span>{tt('admin.nav.kitchen', 'Kitchen')}</span>
                      <span className="badge rounded-pill text-bg-primary">
                        {loading && counts == null ? '…' : kitch}
                      </span>
                    </Link>
                  </li>
                )}

                {cashierAllowed && (
                  <li className="nav-item">
                    <Link
                      className={`nav-link d-flex align-items-center gap-2 ${isActive('/app/admin/cashier') ? 'active' : ''}`}
                      href={tenantHref('/app/admin/cashier')}
                    >
                      <span>{tt('admin.nav.cashier', 'Cashier')}</span>
                      <span className="badge rounded-pill text-bg-success">
                        {loading && counts == null ? '…' : cashq}
                      </span>
                    </Link>
                  </li>
                )}

                {deliveryAllowed && (
                  <li className="nav-item">
                    <Link
                      className={`nav-link d-flex align-items-center gap-2 ${isActive('/app/admin/delivery') ? 'active' : ''}`}
                      href={tenantHref('/app/admin/delivery')}
                    >
                      <span>{tt('admin.nav.delivery', 'Delivery')}</span>
                      <span className="badge rounded-pill text-bg-warning">
                        {loading && counts == null ? '…' : deliv}
                      </span>
                    </Link>
                  </li>
                )}

                {waiterAllowed && (
                  <li className="nav-item">
                    <Link
                      className={`nav-link d-flex align-items-center gap-2 ${isActive('/app/admin/waiter') ? 'active' : ''}`}
                      href={tenantHref('/app/admin/waiter')}
                    >
                      <span>{tt('admin.nav.tables', 'Tables')}</span>
                      <span className="badge rounded-pill text-bg-secondary">
                        {loadingTables && activeTables == null ? '…' : (activeTables ?? 0)}
                      </span>
                    </Link>
                  </li>
                )}

              </ul>

              <div className="d-flex align-items-center gap-2">
                {/* 🆕 Botón Upgrade (sólo si ya tenemos tenantId y orderId resuelto) */}
                {tenantId && upgradeHref ? (
                  <a
                    href={upgradeHref}
                    className="btn btn-warning btn-sm fw-semibold position-relative"
                    style={{ boxShadow: '0 0 0.65rem rgba(255,193,7,.45)' }}
                  >
                    <span className="me-1" aria-hidden>✨</span>
                    Upgrade
                    <span
                      className="position-absolute top-0 start-100 translate-middle badge rounded-pill bg-danger"
                      style={{ fontSize: '0.65rem' }}
                    >
                      NEW
                      <span className="visually-hidden">new</span>
                    </span>
                  </a>
                ) : null}

                {/* Si tu logout es tenant-scoped, usa tenantHref('/app/logout') */}
                <Link className="btn btn-outline-primary btn-sm" href="/logout">
                  {tt('admin.nav.logout', 'Logout')}
                </Link>
              </div>
            </div>
          </div>
        </nav>

        <main className="container py-4">{children}</main>
      </SettingsProvider>
    </TenantProvider>
  );
}
