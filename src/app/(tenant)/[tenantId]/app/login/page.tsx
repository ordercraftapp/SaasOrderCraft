// src/app/(tenant)/[tenantId]/app/login/page.tsx
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
import { FormEvent, useEffect, useRef, useState, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { signInWithEmailAndPassword, getIdTokenResult } from 'firebase/auth';
import { auth } from '@/lib/firebase/client';
import { useAuth } from '@/app/providers';
import { pickRouteByRole } from '@/lib/role-routes';

// Phase C: tenant en cliente
import { useTenantId } from '@/lib/tenant/context';

// Helpers
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

/** Prefija una ruta relativa con /{tenantId} si aún no lo tiene. */
function withTenantPrefix(tenantId: string, pathLike: string): string {
  // Ignora URLs absolutas por seguridad/consistencia
  if (/^https?:\/\//i.test(pathLike)) return `/${tenantId}/app`;
  // Normaliza
  const p = pathLike.startsWith('/') ? pathLike : `/${pathLike}`;
  // Si ya viene con /{tenantId}/..., no tocar
  if (p.startsWith(`/${tenantId}/`)) return p;
  // Prefijo estándar al árbol del app
  return `/${tenantId}${p}`;
}

async function syncRoleCookiesAndRedirect(
  tenantId: string,
  params: URLSearchParams,
  router: ReturnType<typeof useRouter>
) {
  const u = auth.currentUser;
  if (!u) return;

  // Lee claims del ID token actual
  const tok = await getIdTokenResult(u, true);
  const role = computeAppRole(tok.claims);

  // Cookies que usa tu middleware, scopiadas al tenant
  const cookiePath = `/${tenantId}`;
  setCookie('session', '1', cookiePath);
  setCookie('appRole', role, cookiePath);

  // Destino base pedido
  const requestedRaw = params.get('next') || '/app';

  // Ruta por rol (tu helper suele devolver algo tipo "/app/admin" o "/app")
  const rolePath = pickRouteByRole({}, tok.claims as any) || '/app';

  // Si es "customer", respeta ?next=; si no, manda a su dashboard por rol
  const chosen = role === 'customer' ? requestedRaw : rolePath;

  // Prefija con /{tenantId}
  const dest = withTenantPrefix(tenantId, chosen);
  router.replace(dest);
}

function LoginInner() {
  const router = useRouter();
  const params = useSearchParams();
  const { user, loading } = useAuth();
  const tenantId = useTenantId(); // ✅ tenant del contexto

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const inFlightRef = useRef(false);

  // URL para Google con ?next= apuntando al árbol del tenant
  const defaultNext = useMemo(() => (tenantId ? `/${tenantId}/app` : '/app'), [tenantId]);
  const nextParam = encodeURIComponent(params.get('next') || defaultNext);
  // ✅ Versión namespaced por tenant
  const hrefGoogle = tenantId
    ? `/${tenantId}/app/auth/google/start?next=${nextParam}`
    : `/auth/google/start?next=${nextParam}`;

  // Si ya hay sesión al entrar a /login, sincroniza cookies+rol y redirige
  useEffect(() => {
    (async () => {
      if (!tenantId) return; // espera el contexto
      if (!loading && user) {
        try {
          await syncRoleCookiesAndRedirect(tenantId, params, router);
        } catch {
          // fallback mínimo si algo falla leyendo claims
          const requested = params.get('next') || defaultNext;
          router.replace(withTenantPrefix(tenantId, requested));
        }
      }
    })();
  }, [loading, user, params, router, tenantId, defaultNext]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (busy || inFlightRef.current) return;
    setErr(null);
    setBusy(true);
    inFlightRef.current = true;
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
      if (tenantId) {
        await syncRoleCookiesAndRedirect(tenantId, params, router);
      } else {
        // ultra fallback (no debería pasar)
        router.replace('/app');
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

      <div className="text-center my-3">— o —</div>

      {/* Google: solo clientes */}
      <a href={hrefGoogle} className="btn btn-outline-secondary w-100">
        Login with Google
      </a>

      <p className="text-center mt-3 mb-0">
        Don't have an account?{' '}
        <a href={tenantId ? `/${tenantId}/app/account` : '/app/account'} className="link-primary">
          Sign up
        </a>
      </p>
    </main>
  );
}
