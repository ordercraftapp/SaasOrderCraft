// src/app/(site)/page.tsx
import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';

import { adminDb } from '@/lib/firebase/admin';
import { normalizeTenantId, assertValidTenantId } from '@/lib/tenant/validate';

export default function SiteHomePage() {
  return (
    <main className="container py-5">
      <div className="row justify-content-center">
        <div className="col-12 col-md-8 col-lg-6">
          <header className="text-center mb-4">
            <h1 className="h3 fw-bold">Create your restaurant workspace</h1>
            <p className="text-muted">Start your 14-day trial — no credit card required.</p>
          </header>

          <TenantSignupForm />

          <p className="mt-3 text-center text-muted small">
            By continuing you agree to our <Link href="/terms">Terms</Link> and{' '}
            <Link href="/privacy">Privacy Policy</Link>.
          </p>
        </div>
      </div>
    </main>
  );
}

/** ===== Server Action: crea el tenant y redirige ===== */
async function createTenantAction(formData: FormData) {
  'use server';

  const email = String(formData.get('email') || '').trim();
  const wantSub = String(formData.get('subdomain') || '').trim();

  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error('Please enter a valid email.');
  }

  const norm = normalizeTenantId(wantSub);
  assertValidTenantId(norm);

  // Disponibilidad
  const ref = adminDb.doc(`tenants/${norm}`);
  const snap = await ref.get();
  if (snap.exists) throw new Error('This subdomain is already taken.');

  // Crear tenant
  const now = new Date();
  await ref.set({
    tenantId: norm,
    ownerEmail: email,
    planId: 'starter',
    features: {
      marketing: false,
      'advanced-reports': false,
      'delivery-module': true,
      coupons: false,
    },
    status: 'active',
    createdAt: now,
    updatedAt: now,
    customDomain: null,
  });

  // Cookie para que el app lo pueda leer también
  const cookieStore = await cookies();
  cookieStore.set('tenantId', norm, { path: '/', httpOnly: false });

  // Redirige a subdominio en prod; a path en local si no hay wildcard
  const baseDomain = (process.env.NEXT_PUBLIC_BASE_DOMAIN || 'datacraftcoders.cloud').toLowerCase();
  const supportsWildcard =
    process.env.NEXT_PUBLIC_USE_WILDCARD_SUBDOMAINS?.toLowerCase() !== 'false';

  const target = supportsWildcard
    ? `https://${norm}.${baseDomain}/app`
    : `/${norm}/app`;

  redirect(target);
}

/** ===== Form (usa la server action) ===== */
function TenantSignupForm() {
  return (
    <form action={createTenantAction} className="card shadow-sm border-0">
      <div className="card-body p-4">
        <div className="mb-3">
          <label htmlFor="email" className="form-label">Work email</label>
          <input
            id="email"
            name="email"
            type="email"
            required
            placeholder="you@company.com"
            className="form-control"
          />
        </div>

        <div className="mb-2">
          <label htmlFor="subdomain" className="form-label">Choose a subdomain</label>
          <div className="input-group">
            <input
              id="subdomain"
              name="subdomain"
              type="text"
              required
              minLength={3}
              maxLength={63}
              // patrón compatible con el engine 'v' (guion escapado)
              pattern="^[a-z0-9](?:[a-z0-9\-]*[a-z0-9])$"
              placeholder="my-restaurant"
              className="form-control"
            />
            <span className="input-group-text">.datacraftcoders.cloud</span>
          </div>
          <div className="form-text">
            Lowercase letters, numbers, and hyphens. No leading/trailing hyphen.
          </div>
        </div>

        <button type="submit" className="btn btn-primary w-100 mt-3">
          Create my workspace
        </button>
      </div>
    </form>
  );
}
