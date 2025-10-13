'use client';

import { Suspense } from 'react';
import AuthNavbar from '@/app/(tenant)/[tenantId]/components/AuthNavbar';

export const dynamic = 'force-dynamic';

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

// --------- componente real ----------
import { FormEvent, useEffect, useRef, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signInWithEmailAndPassword, getIdTokenResult } from 'firebase/auth';
import { auth } from '@/lib/firebase/client';
import { useAuth } from '@/app/providers';
import { pickRouteByRole } from '@/lib/role-routes';
import { useTenantId } from '@/lib/tenant/context';

type AppRole = 'admin' | 'kitchen' | 'cashier' | 'waiter' | 'delivery' | 'customer';

function computeAppRole(claims: Record<string, any> | null | undefined): AppRole {
  if (!claims) return 'customer';
  if (claims.admin) return 'admin';
  if (claims.kitchen) return 'kitchen';
  if (claims.cashier) return 'cashier';
  if (claims.waiter) return 'waiter';
  if (claims.delivery) return 'delivery';
  const r = String(claims.role || '').toLowerCase();
  if (r === 'admin' || r === 'kitchen' || r === 'cashier' || r === 'waiter' || r === 'delivery') {
    return r as AppRole;
  }
  return 'customer';
}

function setCookie(name: string, value: string, path = '/'): void {
  const base = `${name}=${encodeURIComponent(value)}; Path=${path}; SameSite=Lax`;
  const extra =
    typeof window !== 'undefined' && window.location.protocol === 'https:' ? '; Secure' : '';
  document.cookie = base + extra;
}

function withTenantPrefix(tenantId: string, pathLike: string): string {
  if (/^https?:\/\//i.test(pathLike)) return `/${tenantId}/app`;
  const p = pathLike.startsWith('/') ? pathLike : `/${pathLike}`;
  if (p.startsWith(`/${tenantId}/`)) return p;
  return `/${tenantId}${p}`;
}

async function syncRoleCookiesAndRedirect(
  tenantId: string,
  params: URLSearchParams,
  router: ReturnType<typeof useRouter>
) {
  const u = auth.currentUser;
  if (!u) return;

  const tok = await getIdTokenResult(u, true);
  const role = computeAppRole(tok.claims);

  const cookiePath = `/${tenantId}`;
  setCookie('session', '1', cookiePath);
  setCookie('appRole', role, cookiePath);

  const requestedRaw = params.get('next') || '/app';
  const rolePath = pickRouteByRole({}, tok.claims as any) || '/app';
  const chosen = role === 'customer' ? requestedRaw : rolePath;

  const dest = withTenantPrefix(tenantId, chosen);
  router.replace(dest);
}

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, loading } = useAuth();
  const tenantId = useTenantId();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  // Si ya hay sesión, intenta redirigir (pero solo si tiene membresía)
  useEffect(() => {
    (async () => {
      if (!tenantId) return;
      if (!loading && user) {
        try {
          const idToken = await user.getIdToken(true);
          // Verifica membresía en este tenant
          const me = await fetch(`/${tenantId}/app/api/customers/me`, {
            method: 'GET',
            headers: { Authorization: `Bearer ${idToken}` },
            cache: 'no-store',
          });
          if (me.status === 200) {
            await syncRoleCookiesAndRedirect(tenantId, params, router);
            return;
          }
          // Si 404, no redirige: cuenta no pertenece a este tenant
        } catch {
          // fallback: se queda en login
        }
      }
    })();
  }, [loading, user, params, router, tenantId]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy || inFlightRef.current) return;
    setErr(null);
    setBusy(true);
    inFlightRef.current = true;
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      if (!tenantId) {
        router.replace('/app');
        return;
      }
      // 🔍 Validar membresía del tenant ANTES de redirigir
      const u = auth.currentUser;
      if (!u) throw new Error('No active session');
      const idToken = await u.getIdToken(true);
      const me = await fetch(`/${tenantId}/app/api/customers/me`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${idToken}` },
        cache: 'no-store',
      });
      if (me.status === 200) {
        await syncRoleCookiesAndRedirect(tenantId, params, router);
      } else if (me.status === 404) {
        setErr('Your account does not belong to this restaurant.');
      } else {
        setErr('Could not validate your membership. Please try again.');
      }
    } catch (e: any) {
      setErr(e?.message || 'Could not log in.');
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
            placeholder="youremail@correo.com"
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
          {busy ? 'Loging in...' : 'Login'}
        </button>
        {err && <p className="text-danger mt-3 mb-0">{err}</p>}
      </form>

      {/* ✅ Google eliminado */}
      <div className="text-center my-3" style={{ opacity: 0.4 }}>—</div>

      <p className="text-center mt-3 mb-0">
        Don't have an account?{' '}
        <a href={tenantId ? `/${tenantId}/app/account` : '/app/account'} className="link-primary">
          Sign up
        </a>
      </p>
    </main>
  );
}
