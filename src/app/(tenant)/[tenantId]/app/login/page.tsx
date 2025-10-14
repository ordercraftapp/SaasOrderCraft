// src/app/(tenant)/[tenantId]/app/login/page.tsx
'use client';

import { Suspense, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter, useSearchParams, useParams } from 'next/navigation';
import { signInWithEmailAndPassword, getIdToken } from 'firebase/auth';
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
  | { ok: true; tenantId: string; role: 'admin' | 'kitchen' | 'cashier' | 'waiter' | 'delivery' | 'customer' }
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

  const defaultNext = useMemo(() => (tenantId ? `/${tenantId}/app` : '/app'), [tenantId]);
  const nextParam = useMemo(() => search.get('next') || defaultNext, [search, defaultNext]);

  // Redirigir si ya hay sesión activa (por si vuelve al login con sesión viva)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!tenantId) return;
      const u = auth.currentUser;
      if (!u) return;

      try {
        const idToken = await getIdToken(u, /*forceRefresh*/ true);

        // Refresca rol en cookies (server decide por tenant)
        const resp = await fetch(`/${tenantId}/app/api/auth/refresh-role`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${idToken}` },
        });
        const data = (await resp.json().catch(() => ({}))) as ApiRefreshRoleResp;

        if (!resp.ok || data.ok !== true) return; // se queda en login si algo falla

        // Marca sesión para el scope del tenant (middleware)
        setCookie('session', '1', `/${tenantId}`);

        const role = data.role;
        const target = role === 'admin' ? '/app/admin' : nextParam || '/app';
        if (!cancelled) router.replace(withTenantPrefix(tenantId, target));
      } catch {
        /* se queda en login */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router, tenantId, nextParam]);

  const afterSignIn = useCallback(
    async (idToken: string) => {
      // 1) Pide al server resolver rol por tenant y setear cookie appRole
      const resp = await fetch(`/${tenantId}/app/api/auth/refresh-role`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
      });

      const data = (await resp.json().catch(() => ({}))) as ApiRefreshRoleResp;

      if (!resp.ok || data.ok !== true) {
        const errorMsg = (!data.ok && 'error' in data && data.error) ? data.error : 'Could not validate your role.';
        throw new Error(errorMsg);
      }

      // 2) Marca cookie de sesión scopiada al tenant para tu middleware
      setCookie('session', '1', `/${tenantId}`);

      // 3) Redirige según rol
      const role = data.role;
      const target = role === 'admin' ? '/app/admin' : (search.get('next') || '/app');
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
      const cred = await signInWithEmailAndPassword(auth, email.trim(), password);
      const idToken = await getIdToken(cred.user, /*forceRefresh*/ true);
      await afterSignIn(idToken);
    } catch (e: any) {
      const code = e?.code as string | undefined;
      setErr(mapFirebaseErrorToMsg(code));
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
    </main>
  );
}
