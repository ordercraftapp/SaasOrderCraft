// src/app/(site)/signup/SignupForm.tsx
'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import Header from '@/app/(site)/components/homepage/Header';

type PlanId = 'starter' | 'pro' | 'full';
const PLAN_LABEL: Record<PlanId, string> = {
  starter: 'Starter',
  pro: 'Pro',
  full: 'Full',
};

type CheckResp = { available: boolean; reason?: string };
type OrderResp = { tenantId: string; orderId: string };

function normalizeTenantId(input: string) {
  const lower = (input || '').toLowerCase().trim();
  const cleaned = lower.replace(/[^a-z0-9-]+/g, '-').replace(/-+/g, '-');
  return cleaned.replace(/^-+/, '').replace(/-+$/, '').slice(0, 63);
}

export default function SignupForm({ defaultPlan }: { defaultPlan: PlanId }) {
  const router = useRouter();

  const [plan, setPlan] = useState<PlanId>(defaultPlan);

  // Campos del formulario
  const [email, setEmail] = useState('');
  const [ownerName, setOwnerName] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [phone, setPhone] = useState('');

  // 🔐 Contraseña admin del tenant
  const [password, setPassword] = useState('');
  const [password2, setPassword2] = useState('');

  const [subdomain, setSubdomain] = useState('');
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [availabilityMsg, setAvailabilityMsg] = useState<string>('');

  // Dirección
  const [line1, setLine1] = useState('');
  const [line2, setLine2] = useState('');
  const [city, setCity] = useState('');
  const [region, setRegion] = useState('');
  const [country, setCountry] = useState('');
  const [postalCode, setPostalCode] = useState('');

  // Estados de envío
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string>('');

  // Normalización live del subdominio
  function onSubdomainChange(v: string) {
    const norm = normalizeTenantId(v);
    setSubdomain(norm);
    setAvailable(null);
    setAvailabilityMsg('');
  }

  async function checkAvailability() {
    try {
      setChecking(true);
      setAvailable(null);
      setAvailabilityMsg('');

      const desiredSubdomain = normalizeTenantId(subdomain);
      if (!desiredSubdomain || desiredSubdomain.length < 3) {
        setAvailabilityMsg('Subdomain must be at least 3 characters.');
        setAvailable(false);
        return;
      }

      const resp = await fetch('/api/subdomain-check', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        // 👇 Enviamos también el email para asociar el hold al mismo correo
        body: JSON.stringify({ desiredSubdomain, email }),
      });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(text || 'Subdomain check failed.');
      }
      const data: CheckResp = await resp.json();
      setAvailable(!!data.available);
      setAvailabilityMsg(
        data.available ? 'This subdomain is available!' : data.reason || 'This subdomain is already taken.'
      );
    } catch (err: any) {
      setAvailable(false);
      setAvailabilityMsg(err?.message || 'Could not verify subdomain.');
    } finally {
      setChecking(false);
    }
  }

  const passwordValid = password.length >= 8;
  const passwordsMatch = password && password2 && password === password2;

  const canSubmit = useMemo(() => {
    const emailOk = /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim());
    const subOk = Boolean(subdomain && subdomain.length >= 3 && available === true);
    const reqAddress = Boolean(line1 && city && country);
    return emailOk && ownerName && companyName && subOk && reqAddress && passwordValid && passwordsMatch && !submitting;
  }, [email, ownerName, companyName, subdomain, available, line1, city, country, passwordValid, passwordsMatch, submitting]);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);
    setErrorMsg('');

    try {
      const desiredSubdomain = normalizeTenantId(subdomain);
      const body = {
        plan,
        companyName,
        adminName: ownerName,
        adminEmail: email,
        adminPassword: password, // ← 🔐 nuevo
        phone: phone || undefined,
        address: {
          line1,
          line2: line2 || undefined,
          city,
          region: region || undefined,
          country,
          postalCode: postalCode || undefined,
        },
        desiredSubdomain,
      };

      const resp = await fetch('/api/tenant-order', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(text || 'Failed to create order.');
      }
      const data: OrderResp = await resp.json();
      router.push(`/checkout?tenantId=${encodeURIComponent(data.tenantId)}&orderId=${encodeURIComponent(data.orderId)}`);
    } catch (err: any) {
      setErrorMsg(err?.message || 'Something went wrong.');
      setSubmitting(false);
    }
  }

  return (
  <>
    {/* Header fijado arriba */}
    <div className="fixed-top" style={{ zIndex: 1030 }}>
      <Header />
    </div>

    {/* Contenedor principal: paddingTop mayor para asegurar separación del Header.
        Ajusta --site-header-height si tu Header tiene otra altura. Aquí por defecto es 112px */}
    <div style={{ paddingTop: 'var(--site-header-height, 112px)' }}>
      <div className="row justify-content-center">
        <div className="col-12 col-lg-10">
          <form onSubmit={onSubmit} className="card shadow-sm border-0">
            <div className="card-body p-4">
              {/* Plan */}
              <div className="mb-3">
                <label className="form-label">Plan</label>
                <select
                  className="form-select"
                  value={plan}
                  onChange={(e) => setPlan(e.target.value as PlanId)}
                >
                  <option value="starter">Starter</option>
                  <option value="pro">Pro</option>
                  <option value="full">Full</option>
                </select>
                <div className="form-text">Selected: {PLAN_LABEL[plan]}</div>
              </div>

              {/* Company & Owner */}
              <div className="row">
                <div className="col-12 col-md-6 mb-3">
                  <label className="form-label">Restaurant / Company name</label>
                  <input
                    type="text"
                    className="form-control"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    required
                    placeholder="My Restaurant LLC"
                  />
                </div>
                <div className="col-12 col-md-6 mb-3">
                  <label className="form-label">Owner full name</label>
                  <input
                    type="text"
                    className="form-control"
                    value={ownerName}
                    onChange={(e) => setOwnerName(e.target.value)}
                    required
                    placeholder="John Doe"
                  />
                </div>
              </div>

              {/* Email & Phone */}
              <div className="row">
                <div className="col-12 col-md-6 mb-3">
                  <label className="form-label">Admin email</label>
                  <input
                    type="email"
                    className="form-control"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    placeholder="you@company.com"
                  />
                </div>
                <div className="col-12 col-md-6 mb-3">
                  <label className="form-label">Phone (optional)</label>
                  <input
                    type="tel"
                    className="form-control"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="+502 5555 5555"
                  />
                </div>
              </div>

              {/* 🔐 Password */}
              <div className="row">
                <div className="col-12 col-md-6 mb-3">
                  <label className="form-label">Admin password</label>
                  <input
                    type="password"
                    className={`form-control ${password ? (passwordValid ? 'is-valid' : 'is-invalid') : ''}`}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                    placeholder="At least 8 characters"
                    autoComplete="new-password"
                  />
                  <div className="form-text">Min. 8 characters.</div>
                </div>
                <div className="col-12 col-md-6 mb-3">
                  <label className="form-label">Confirm password</label>
                  <input
                    type="password"
                    className={`form-control ${password2 ? (passwordsMatch ? 'is-valid' : 'is-invalid') : ''}`}
                    value={password2}
                    onChange={(e) => setPassword2(e.target.value)}
                    required
                    placeholder="Repeat your password"
                    autoComplete="new-password"
                  />
                  {!passwordsMatch && password2 ? (
                    <div className="invalid-feedback d-block">Passwords do not match.</div>
                  ) : null}
                </div>
              </div>

              {/* Subdomain */}
              <div className="mb-2">
                <label className="form-label">Choose a subdomain</label>
                <div className="input-group">
                  <input
                    type="text"
                    required
                    minLength={3}
                    maxLength={63}
                    value={subdomain}
                    onChange={(e) => onSubdomainChange(e.target.value)}
                    className={`form-control ${available === true ? 'is-valid' : available === false ? 'is-invalid' : ''}`}
                    placeholder="my-restaurant"
                    pattern="^[a-z0-9](?:[a-z0-9\\-]*[a-z0-9])$"
                    aria-describedby="domainHelp"
                  />
                  <span className="input-group-text">.datacraftcoders.cloud</span>
                </div>
                <div id="domainHelp" className="form-text">
                  Lowercase letters, numbers, and hyphens. No leading/trailing hyphen.
                </div>
                <div className={`small mt-1 ${available ? 'text-success' : 'text-danger'}`}>
                  {availabilityMsg}
                </div>
                <button
                  type="button"
                  className="btn btn-outline-secondary btn-sm mt-2"
                  onClick={checkAvailability}
                  disabled={checking || !subdomain}
                >
                  {checking ? 'Checking…' : 'Check availability'}
                </button>
              </div>

              {/* Address */}
              <div className="row mt-3">
                <div className="col-12 mb-3">
                  <label className="form-label">Address line 1</label>
                  <input
                    type="text"
                    className="form-control"
                    value={line1}
                    onChange={(e) => setLine1(e.target.value)}
                    required
                    placeholder="123 Main St"
                  />
                </div>
                <div className="col-12 mb-3">
                  <label className="form-label">Address line 2 (optional)</label>
                  <input
                    type="text"
                    className="form-control"
                    value={line2}
                    onChange={(e) => setLine2(e.target.value)}
                    placeholder="Suite / Unit"
                  />
                </div>
                <div className="col-12 col-md-6 mb-3">
                  <label className="form-label">City</label>
                  <input
                    type="text"
                    className="form-control"
                    value={city}
                    onChange={(e) => setCity(e.target.value)}
                    required
                    placeholder="Guatemala City"
                  />
                </div>
                <div className="col-12 col-md-6 mb-3">
                  <label className="form-label">Region / State</label>
                  <input
                    type="text"
                    className="form-control"
                    value={region}
                    onChange={(e) => setRegion(e.target.value)}
                    placeholder="Guatemala"
                  />
                </div>
                <div className="col-12 col-md-6 mb-3">
                  <label className="form-label">Country</label>
                  <input
                    type="text"
                    className="form-control"
                    value={country}
                    onChange={(e) => setCountry(e.target.value)}
                    required
                    placeholder="Guatemala"
                  />
                </div>
                <div className="col-12 col-md-6 mb-3">
                  <label className="form-label">Postal code</label>
                  <input
                    type="text"
                    className="form-control"
                    value={postalCode}
                    onChange={(e) => setPostalCode(e.target.value)}
                    placeholder="01001"
                  />
                </div>
              </div>

              {/* Error general */}
              {errorMsg ? <div className="alert alert-danger mt-2">{errorMsg}</div> : null}

              {/* Submit */}
              <button type="submit" className="btn btn-primary w-100 mt-2" disabled={!canSubmit}>
                {submitting ? 'Creating…' : 'Continue'}
              </button>

              <p className="mt-3 text-center text-muted small">
                By continuing you agree to our <Link href="/terms">Terms</Link> and{' '}
                <Link href="/privacy">Privacy Policy</Link>.
              </p>
            </div>
          </form>
        </div>
      </div>
    </div>
  </>
);
}
