// src/app/(site)/checkout/CheckoutClient.tsx
'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';

type Summary = {
  tenantId: string;
  orderId: string;
  plan: 'starter' | 'pro' | 'full';
  status: 'draft' | 'active' | 'suspended';
  desiredSubdomain: string;
  customer: { name: string; email: string };
  company: {
    name: string;
    address: {
      line1: string; line2?: string | null;
      city: string; region?: string | null;
      country: string; postalCode?: string | null;
    };
    phone?: string | null;
  };
  amountCents: number;
  currency: string;
  paymentStatus: 'pending' | 'paid' | 'failed';
  orderStatus: 'created' | 'provisioned' | 'cancelled';
  createdAt?: unknown;
};

export default function CheckoutClient({ tenantId, orderId }: { tenantId: string; orderId: string }) {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [err, setErr] = useState<string>('');
  const [provisioning, setProvisioning] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        if (!tenantId || !orderId) {
          setErr('Missing tenantId or orderId.');
          setLoading(false);
          return;
        }
        // OJO: el grupo (site) NO va en el path público de la API
        const url = `/api/tenant-order?tenantId=${encodeURIComponent(tenantId)}&orderId=${encodeURIComponent(orderId)}`;
        const resp = await fetch(url, { cache: 'no-store' });
        if (!resp.ok) throw new Error(await resp.text());
        const data = (await resp.json()) as Summary;
        if (!cancelled) {
          setSummary(data);
          setErr('');
        }
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || 'Failed to load summary.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [tenantId, orderId]);

  async function createRestaurant() {
    if (!summary) return;
    try {
      setProvisioning(true);
      // OJO: el grupo (site) NO va en el path público de la API
      const resp = await fetch('/api/provision-tenant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: summary.tenantId, orderId: summary.orderId }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const data = await resp.json();
      const url = data?.successUrl || `/success?tenantId=${encodeURIComponent(summary.tenantId)}`;
      router.push(url);
    } catch (e: any) {
      setErr(e?.message || 'Provisioning failed.');
      setProvisioning(false);
    }
  }

  return (
    <div className="row justify-content-center">
      <div className="col-12 col-lg-8">
        <header className="mb-4 text-center">
          <h1 className="h4 fw-bold">Checkout</h1>
          <p className="text-muted">Review your details and create your restaurant workspace.</p>
        </header>

        <div className="card shadow-sm border-0">
          <div className="card-body p-4">
            {loading ? (
              <p className="text-muted">Loading…</p>
            ) : err ? (
              <div className="alert alert-danger">{err}</div>
            ) : summary ? (
              <>
                <div className="mb-3">
                  <h2 className="h6 fw-semibold">Plan</h2>
                  <p className="mb-0 text-capitalize">{summary.plan}</p>
                </div>

                <div className="mb-3">
                  <h2 className="h6 fw-semibold">Subdomain</h2>
                  <p className="mb-0">
                    <strong>{summary.desiredSubdomain}</strong>.datacraftcoders.cloud
                  </p>
                </div>

                <div className="mb-3">
                  <h2 className="h6 fw-semibold">Owner</h2>
                  <p className="mb-0">
                    {summary.customer?.name} — {summary.customer?.email}
                  </p>
                </div>

                <div className="mb-3">
                  <h2 className="h6 fw-semibold">Company</h2>
                  <p className="mb-0">{summary.company?.name}</p>
                  <p className="mb-0 text-muted">
                    {summary.company?.address?.line1}
                    {summary.company?.address?.line2 ? `, ${summary.company.address.line2}` : ''}
                    {', '}
                    {summary.company?.address?.city}
                    {summary.company?.address?.region ? `, ${summary.company.address.region}` : ''}
                    {', '}
                    {summary.company?.address?.country}
                    {summary.company?.address?.postalCode ? ` ${summary.company.address.postalCode}` : ''}
                  </p>
                  {summary.company?.phone ? (
                    <p className="mb-0 text-muted">Phone: {summary.company.phone}</p>
                  ) : null}
                </div>

                <div className="mb-3">
                  <h2 className="h6 fw-semibold">Order</h2>
                  <p className="mb-1">
                    Status: <span className="text-capitalize">{summary.orderStatus}</span>
                  </p>
                  <p className="mb-0">
                    Amount: {(summary.amountCents / 100).toFixed(2)} {summary.currency}{' '}
                    <span className="text-muted">(payment pending)</span>
                  </p>
                </div>
              </>
            ) : null}

            <div className="d-flex gap-2 mt-3">
              <Link href="/signup" className="btn btn-outline-secondary">
                Back
              </Link>
              <button
                className="btn btn-primary flex-fill"
                onClick={createRestaurant}
                disabled={!summary || provisioning}
              >
                {provisioning ? 'Creating…' : 'Create my restaurant'}
              </button>
            </div>

            <p className="mt-3 text-center text-muted small">
              By continuing you agree to our <Link href="/terms">Terms</Link> and{' '}
              <Link href="/privacy">Privacy Policy</Link>.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
