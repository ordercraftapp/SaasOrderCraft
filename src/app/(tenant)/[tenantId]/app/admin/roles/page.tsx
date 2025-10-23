'use client';

import React from 'react';
import Protected from '@/app/(tenant)/[tenantId]/components/Protected';
import AdminOnly from '@/app/(tenant)/[tenantId]/components/AdminOnly';
import ToolGate from '@/components/ToolGate';
import { useTenantId } from '@/lib/tenant/context';

// 🔤 i18n
import { t as translate } from '@/lib/i18n/t';
import { useTenantSettings } from '@/lib/settings/hooks';

/* ---- Firebase Auth (cliente) ---- */
function getFirebaseClientConfig() {
  return {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
  };
}
async function ensureFirebaseApp() {
  const app = await import('firebase/app');
  if (!app.getApps().length) {
    const cfg = getFirebaseClientConfig();
    if (cfg.apiKey && cfg.authDomain && cfg.projectId && cfg.appId) {
      app.initializeApp(cfg);
    } else {
      console.warn('[Firebase] Faltan variables NEXT_PUBLIC_* para inicializar el cliente.');
    }
  }
}
async function getAuthMod() {
  await ensureFirebaseApp();
  return await import('firebase/auth');
}
async function getIdTokenSafe(forceRefresh = false): Promise<string | null> {
  try {
    const { getAuth } = await getAuthMod();
    const auth = getAuth();
    const u = auth.currentUser;
    if (!u) return null;
    return await u.getIdToken(forceRefresh);
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

function useAuthClaims() {
  const [authReady, setAuthReady] = React.useState(false);
  const [user, setUser] = React.useState<any | null>(null);
  const [claims, setClaims] = React.useState<any | null>(null);
  React.useEffect(() => {
    let alive = true;
    (async () => {
      const { onAuthStateChanged, getAuth, getIdTokenResult } = await getAuthMod();
      const auth = getAuth();
      const unsub = onAuthStateChanged(auth, async (u) => {
        if (!alive) return;
        setUser(u ?? null);
        if (u) {
          // Forzar refresh para traer claims actualizados
          const res = await getIdTokenResult(u, true);
          setClaims(res.claims || null);
        } else {
          setClaims(null);
        }
        setAuthReady(true);
      });
      return () => unsub();
    })();
    return () => { alive = false; };
  }, []);
  return { authReady, user, claims } as const;
}

/* ---- Server actions (import) ---- */
import { listUsersAction, setClaimsAction } from './actions';

/* ---- Tipos ---- */
type UserRow = {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  disabled: boolean;
  claims: Record<string, any>;
  metadata?: { creationTime?: string; lastSignInTime?: string };
};

type RoleKey = 'admin' | 'kitchen' | 'waiter' | 'delivery' | 'cashier';

/* ✅ Incluimos cashier */
const ROLES: Array<{ key: RoleKey; label: string }> = [
  { key: 'admin', label: 'Admin' },
  { key: 'kitchen', label: 'Kitchen' },
  { key: 'waiter', label: 'Waiter' },
  { key: 'delivery', label: 'Delivery' },
  { key: 'cashier', label: 'Cashier' },
];

function RolesPage_Inner() {
  const tenantId = useTenantId();
  const { authReady, user, claims } = useAuthClaims();

  // ¿Es admin del tenant actual? (tolerante a {roles:{...}} y plano)
  const isTenantAdmin = React.useMemo(() => {
    if (!tenantId) return false;
    const node = claims?.tenants?.[tenantId];
    const flags = normalizeTenantNode(node);
    return !!(flags?.admin || claims?.role === 'superadmin' || claims?.admin === true);
  }, [claims, tenantId]);

  // 🔎 Log de diagnóstico (puedes quitar en prod)
  React.useEffect(() => {
    if (tenantId) {
      const raw = claims?.tenants?.[tenantId];
      const flags = normalizeTenantNode(raw);
      console.log('[roles:page] context', {
        tenantId,
        isTenantAdmin,
        claims,
        tenantClaims: raw || null,
        tenantFlagsNormalized: flags || null,
      });
    }
  }, [tenantId, claims, isTenantAdmin]);

  // idioma del tenant
  const { settings } = useTenantSettings();
  const lang = React.useMemo(() => {
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

  const [rows, setRows] = React.useState<UserRow[]>([]);
  const [loading, setLoading] = React.useState(false);
  const [err, setErr] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      if (!tenantId) throw new Error('Missing tenantId');
      setErr(null);
      setLoading(true);
      console.log('[roles:page] load:start', { tenantId });
      const idToken = await getIdTokenSafe(true);
      if (!idToken) throw new Error('Not authenticated');
      const data = await listUsersAction({ idToken, tenantId, pageSize: 200 });
      console.log('[roles:page] load:success', { count: (data.users || []).length });
      setRows(data.users || []);
    } catch (e: any) {
      console.error('[roles:page] load:error', e);
      setErr(e?.message || 'Error');
    } finally {
      setLoading(false);
    }
  }, [tenantId]);

  React.useEffect(() => {
    if (user && isTenantAdmin) load();
  }, [user, isTenantAdmin, load]);

  const onToggle = async (uid: string, role: RoleKey, value: boolean) => {
  try {
    console.log("[roles:page] toggle", { uid, role, value, tenantId });
    if (!tenantId) throw new Error("Missing tenantId");
    const idToken = await getIdTokenSafe(true);
    if (!idToken) throw new Error("Not authenticated");

    const changes: Partial<Record<RoleKey, boolean>> = { [role]: value };

    // Llama action (Node runtime) y usa la respuesta para pintar optimista
    const res = await setClaimsAction({ idToken, tenantId, uid, changes });

    // ✅ UI optimista inmediata con lo que devolvió el server
    setRows((prev) =>
      prev.map((u) => {
        if (u.uid !== uid) return u;
        const tenants = { ...(u.claims?.tenants || {}) };
        tenants[tenantId] = res.savedTenantFlags || {};
        return { ...u, claims: { ...(u.claims || {}), tenants } };
      })
    );

    // 🔄 Luego refrescas la lista completa
    await load();

    alert(
      tt(
        "admin.roles.alert.updated",
        "Roles updated. The user must refresh their session to obtain new permissions."
      )
    );
  } catch (e: any) {
    console.error("[roles:page] toggle:error", e);
    alert(e?.message || tt("admin.roles.alert.updateError", "Could not update roles"));
  }
};


  if (!authReady) return <div className="container py-3">{tt('admin.roles.init', 'Initializing…')}</div>;
  if (!user) return <div className="container py-3 text-danger">{tt('admin.common.mustSignIn', 'You must sign in.')}</div>;
  if (!tenantId) return <div className="container py-3 text-danger">{tt('admin.common.missingTenant', 'Missing tenant context.')}</div>;
  if (!isTenantAdmin) return <div className="container py-3 text-danger">{tt('admin.common.unauthorized', 'Unauthorized (admins only).')}</div>;

  return (
    <div className="container py-3">
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h1 className="h4 m-0">{tt('admin.roles.title', 'Manage roles')}</h1>
        <button className="btn btn-outline-secondary btn-sm" onClick={load} disabled={loading}>
          {loading ? tt('common.loading', 'Loading…') : tt('common.refresh', 'Refresh')}
        </button>
      </div>

      {err && <div className="alert alert-danger">{err}</div>}

      <div className="table-responsive">
        <table className="table align-middle">
          <thead>
            <tr>
              <th>{tt('admin.roles.col.user', 'User')}</th>
              {ROLES.map((r) => (
                <th key={r.key}>{tt(`admin.roles.role.${r.key}`, r.label)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => {
              const raw = u.claims?.tenants?.[tenantId];
              const flags = normalizeTenantNode(raw);
              return (
                <tr key={u.uid}>
                  <td>
                    <div className="fw-semibold">{u.displayName || u.email || tt('admin.roles.noName', '(no name)')}</div>
                    <div className="text-muted small">{u.email}</div>
                    {u.disabled && (
                      <span className="badge bg-warning text-dark">
                        {tt('admin.roles.badge.disabled', 'Disabled')}
                      </span>
                    )}
                  </td>

                  {ROLES.map((r) => {
                    const checked = !!flags?.[r.key];
                    return (
                      <td key={r.key}>
                        <input
                          type="checkbox"
                          className="form-check-input"
                          checked={checked}
                          onChange={(e) => onToggle(u.uid, r.key, e.currentTarget.checked)}
                        />
                      </td>
                    );
                  })}
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={1 + ROLES.length} className="text-muted">
                  {tt('admin.roles.noResults', 'No results')}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="text-muted small mt-2">
        *{' '}
        {tt(
          'admin.roles.note.refreshNeeded',
          'The user must sign out and sign back in (or refresh their ID token) to receive the new permissions.'
        )}
      </div>
    </div>
  );
}

export default function RolesPage() {
  return (
    <ToolGate feature="roles">
      <Protected>
        <AdminOnly>
          <RolesPage_Inner />
        </AdminOnly>
      </Protected>
    </ToolGate>
  );
}
