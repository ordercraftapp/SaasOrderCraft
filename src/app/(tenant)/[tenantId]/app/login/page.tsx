// src/app/(tenant)/[tenantId]/app/login/page.tsx
'use client';

import { Suspense, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams, useParams } from 'next/navigation';
import { signInWithEmailAndPassword, getIdToken, getIdTokenResult } from 'firebase/auth';
import { auth } from '@/lib/firebase/client';
import AuthNavbar from '@/app/(tenant)/[tenantId]/components/AuthNavbar';

export const dynamic = 'force-dynamic';

// ------------------
// Helpers (scoped)
// ------------------
function setCookie(name: string, value: string, path = '/') {
  const base = `${name}=${encodeURIComponent(value)}; Path=${path}; SameSite=Lax`;
  const extra =
    typeof window !== 'undefined' && window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = base + extra;
}

function withTenantPrefix(tenantId: string, pathLike: string): string {
  if (!tenantId) return pathLike || '/app';
  if (/^https?:\/\//i.test(pathLike)) return `/${tenantId}/app`;
  const p = pathLike.startsWith('/') ? pathLike : `/${pathLike}`;
  if (p.startsWith(`/${tenantId}/`)) return p;
  return `/${tenantId}${p}`;
}

function mapFirebaseErrorToMsg(code?: string): string {
  switch (code) {
    case 'auth/invalid-email':
      return 'Invalid email address.';
    case 'auth/user-disabled':
      return 'This account has been disabled.';
    case 'auth/user-not-found':
      return 'No account found with this email.';
    case 'auth/wrong-password':
      return 'Incorrect password.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Try again later.';
    case 'auth/network-request-failed':
      return 'Network error. Check your connection.';
    default:
      return 'Could not log in.';
  }
}

function roleToDefaultPath(role: 'admin' | 'kitchen' | 'cashier' | 'waiter' | 'delivery' | 'customer'): string {
  switch (role) {
    case 'admin':    return '/app/admin';
    case 'kitchen':  return '/app/admin/kitchen';
    case 'cashier':  return '/app/admin/cashier';
    case 'waiter':   return '/app/admin/waiter';
    case 'delivery': return '/app/admin/delivery';
    default:         return '/app/app'; // portal cliente
  }
}

function Fallback() {
  return (
    <main className="container py-4" style={{ maxWidth: 480 }}>
      <h1 className="h4 text-center">Loading...</h1>
    </main>
  );
}

export default function LoginPage() {
  return (
    <>
      <AuthNavbar />
      <Suspense fallback={<Fallback />}>
        <LoginInner />
      </Suspense>
    </>
  );
}

type ApiRefreshRoleResp =
  | {
      ok: true;
      tenantId: string;
      role: 'admin' | 'kitchen' | 'cashier' | 'waiter' | 'delivery' | 'customer';
      claimsUpdated?: boolean;
    }
  | { ok: false; error?: string };

function LoginInner() {
  const router = useRouter();
  const search = useSearchParams();
  const { tenantId } = useParams<{ tenantId: string }>();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  // 👇 por defecto apunta al área cliente (solo se usa como fallback en el render, ya NO en el redirect de sesión viva)
  const defaultNext = useMemo(() => (tenantId ? `/${tenantId}/app/app` : '/app/app'), [tenantId]);

  // Redirigir si ya hay sesión activa (por si vuelve al login con sesión viva)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!tenantId) return;
      const u = auth.currentUser;
      if (!u) return;

      try {
        const idToken = await getIdToken(u, /*forceRefresh*/ true);
        const tokenRes = await getIdTokenResult(u, /*forceRefresh*/ true);

        console.groupCollapsed('[login] session-alive: pre-refresh-role');
        console.log('tenantId', tenantId);
        console.log('uid', u.uid);
        console.log('raw next (search.get("next"))', search.get('next'));
        console.log('claims.tenants[tenantId]', (tokenRes.claims as any)?.tenants?.[tenantId] || null);
        console.groupEnd();

        // Refresca rol en cookies (server decide por tenant)
        const resp = await fetch(`/${tenantId}/app/api/auth/refresh-role`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${idToken}` },
          cache: 'no-store',
        });
        const data = (await resp.json().catch(() => ({}))) as ApiRefreshRoleResp;

        console.groupCollapsed('[login] session-alive: refresh-role response');
        console.log('status', resp.status, 'ok', resp.ok);
        console.log('data', data);
        console.groupEnd();

        if (!resp.ok || data.ok !== true) return; // se queda en login si algo falla

        // Marca sesión para el scope del tenant (middleware)
        setCookie('session', '1', `/${tenantId}`);

        const role = data.role;
        const rawNext = search.get('next'); // ⚠️ usar sólo el next crudo aquí
        const target = rawNext || roleToDefaultPath(role);

        console.groupCollapsed('[login] session-alive: redirect decision');
        console.log('role', role);
        console.log('rawNext', rawNext);
        console.log('target', target);
        console.groupEnd();

        if (!cancelled) router.replace(withTenantPrefix(tenantId, target));
      } catch (e) {
        console.error('[login] session-alive error', e);
        /* se queda en login */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, tenantId, search]);

  const afterSignIn = useCallback(
    async (idToken: string) => {
      // log pre-refresh claims
      try {
        const u = auth.currentUser;
        if (u) {
          const tokenResBefore = await getIdTokenResult(u, /*forceRefresh*/ true);
          console.groupCollapsed('[login] afterSignIn: pre refresh-role claims');
          console.log('tenantId', tenantId);
          console.log('uid', u.uid);
          console.log('claims.tenants[tenantId]', (tokenResBefore.claims as any)?.tenants?.[tenantId] || null);
          console.groupEnd();
        }
      } catch {}

      const resp = await fetch(`/${tenantId}/app/api/auth/refresh-role`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
        cache: 'no-store',
      });
      const data = (await resp.json().catch(() => ({}))) as ApiRefreshRoleResp;

      console.groupCollapsed('[login] afterSignIn: refresh-role response');
      console.log('status', resp.status, 'ok', resp.ok);
      console.log('data', data);
      console.groupEnd();

      if (!resp.ok || data.ok !== true) {
        const errorMsg =
          (!data.ok && 'error' in data && data.error)
            ? data.error
            : 'Could not validate your role.';
        throw new Error(errorMsg);
      }

      // Si el server actualizó claims, fuerza un refresh local del token y vuelve a loguear claims
      if (data.claimsUpdated) {
        const u = auth.currentUser;
        if (u) {
          await u.getIdToken(true);
          const tokenResAfter = await getIdTokenResult(u, /*forceRefresh*/ true);
          console.groupCollapsed('[login] afterSignIn: post refresh-role claims (forced refresh)');
          console.log('tenantId', tenantId);
          console.log('uid', u.uid);
          console.log('claims.tenants[tenantId]', (tokenResAfter.claims as any)?.tenants?.[tenantId] || null);
          console.groupEnd();
        }
      }

      setCookie('session', '1', `/${tenantId}`);

      const role = data.role;
      const rawNext = search.get('next'); // respeta next si viene; si no, ruta por rol
      const target = rawNext || roleToDefaultPath(role);

      console.groupCollapsed('[login] afterSignIn: redirect decision');
      console.log('role', role);
      console.log('rawNext', rawNext);
      console.log('target', target);
      console.groupEnd();

      router.replace(withTenantPrefix(tenantId!, target));
    },
    [router, search, tenantId]
  );

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy || inFlightRef.current) return;

    setErr(null);
    setBusy(true);
    inFlightRef.current = true;

    try {
      console.groupCollapsed('[login] onSubmit');
      console.log('email', email);
      console.groupEnd();

      const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
      const idToken = await getIdToken(cred.user, /*forceRefresh*/ true);

      await afterSignIn(idToken);
    } catch (e: any) {
      const code = e?.code as string | undefined;
      const msg = mapFirebaseErrorToMsg(code);
      console.error('[login] signIn error', { code, msg, raw: e });
      setErr(msg);
    } finally {
      inFlightRef.current = false;
      setBusy(false);
    }
  }

  return (
    <main className="container py-4" style={{ maxWidth: 480 }}>
      <h1 className="h3 mb-3 text-center">Login</h1>

      <form onSubmit={onSubmit} className="card p-3 border-0 shadow-sm">
        <div className="mb-3">
          <label className="form-label">Email</label>
          <input
            className="form-control"
            type="email"
            autoComplete="email"
            placeholder="you@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={busy}
          />
        </div>

        <div className="mb-3">
          <label className="form-label">Password</label>
          <input
            className="form-control"
            type="password"
            autoComplete="current-password"
            placeholder="********"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            disabled={busy}
          />
        </div>
        <button className="btn btn-primary w-100" disabled={busy}>
          {busy ? 'Signing in…' : 'Login'}
        </button>

        {err && <p className="text-danger mt-3 mb-0">{err}</p>}
      </form>

      <p className="text-center mt-3 mb-0">
        Don&apos;t have an account?{' '}
        <a href={tenantId ? `/${tenantId}/app/account` : '/app/account'} className="link-primary">
          Sign up
        </a>
      </p>

      {/* Debug visual mínimo */}
      <pre className="mt-3 small text-muted">
        tenantId: {String(tenantId)}{"\n"}
        defaultNext: {defaultNext}
      </pre>
    </main>
  );
}
