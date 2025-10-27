// src/app/(site)/checkout/CheckoutClient.tsx
'use client';

import { useEffect, useState, useCallback } from 'react';
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
  currency: string; // e.g. "USD", "GTQ"
  paymentStatus: 'pending' | 'paid' | 'failed';
  orderStatus: 'created' | 'provisioned' | 'cancelled';
  createdAt?: unknown;
};

declare global {
  interface Window {
    paypal?: any;
  }
}

export default function CheckoutClient({ tenantId, orderId }: { tenantId: string; orderId: string }) {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [err, setErr] = useState<string>('');
  const [provisioning, setProvisioning] = useState(false);
  const [paypalReady, setPaypalReady] = useState(false);
  const [renderedButtons, setRenderedButtons] = useState(false);

  const reloadSummary = useCallback(async () => {
    if (!tenantId || !orderId) return;
    try {
      const url = `/api/tenant-order?tenantId=${encodeURIComponent(tenantId)}&orderId=${encodeURIComponent(orderId)}`;
      const resp = await fetch(url, { cache: 'no-store' });
      if (!resp.ok) throw new Error(await resp.text());
      const data = (await resp.json()) as Summary;
      setSummary(data);
      setErr('');
    } catch (e: any) {
      setErr(e?.message || 'Failed to load summary.');
    }
  }, [tenantId, orderId]);

  // Initial load
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!tenantId || !orderId) {
          if (!cancelled) {
            setErr('Missing tenantId or orderId.');
            setLoading(false);
          }
          return;
        }
        await reloadSummary();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tenantId, orderId, reloadSummary]);

  // Load PayPal SDK once we know currency (from summary)
  useEffect(() => {
    if (!summary || summary.paymentStatus === 'paid') return; // no need after paid
    if (window.paypal) {
      setPaypalReady(true);
      return;
    }
    const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID;
    if (!clientId) {
      // eslint-disable-next-line no-console
      console.error('Missing NEXT_PUBLIC_PAYPAL_CLIENT_ID');
      return;
    }
    const currency = (summary.currency || 'USD').toUpperCase();

    const script = document.createElement('script');
    script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=${encodeURIComponent(currency)}&intent=capture`;
    script.async = true;
    script.onload = () => setPaypalReady(true);
    script.onerror = () => setErr('Failed to load PayPal SDK.');
    document.body.appendChild(script);

    return () => {
      // do not remove SDK in case user navigates back/forward
    };
  }, [summary]);

  // Render PayPal Buttons when ready
  useEffect(() => {
    if (!paypalReady || !summary) return;
    if (summary.paymentStatus === 'paid') return;
    if (renderedButtons) return;

    const containerId = 'paypal-buttons';
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!window.paypal || !window.paypal.Buttons) {
      setErr('PayPal Buttons not available.');
      return;
    }

    const buttons = window.paypal.Buttons({
      style: { layout: 'vertical', shape: 'pill', label: 'pay' },

      createOrder: async () => {
        try {
          const resp = await fetch('/api/paypal/create-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tenantId: summary.tenantId, orderId: summary.orderId }),
          });
          const json = await resp.json();
          if (!resp.ok || !json?.paypalOrderId) {
            throw new Error(json?.error || 'Could not create PayPal order.');
          }
          return json.paypalOrderId;
        } catch (e: any) {
          setErr(e?.message || 'Could not create PayPal order.');
          throw e;
        }
      },

      onApprove: async (data: any) => {
        try {
          const paypalOrderId = data?.orderID;
          if (!paypalOrderId) throw new Error('Missing PayPal order ID.');

          const resp = await fetch('/api/paypal/capture', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tenantId: summary.tenantId, orderId: summary.orderId, paypalOrderId }),
          });
          const json = await resp.json();
          if (!resp.ok || !json?.ok) {
            throw new Error(json?.error || 'Payment capture failed.');
          }

          // Refresh summary to reflect paymentStatus = 'paid'
          await reloadSummary();
        } catch (e: any) {
          setErr(e?.message || 'Payment processing failed.');
        }
      },

      onCancel: () => {
        // Optional: inform user
      },

      onError: (err: any) => {
        setErr(err?.message || 'PayPal error.');
      },
    });

    buttons.render(`#${containerId}`);
    setRenderedButtons(true);

    // no cleanup (paypal handles)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paypalReady, summary, renderedButtons, reloadSummary]);

  async function createRestaurant() {
    if (!summary) return;
    try {
      setProvisioning(true);
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

  // Trial (7-day) – provision without payment (backend must accept `trial: true`)
  async function startTrial() {
    if (!summary) return;
    try {
      setProvisioning(true);
      const resp = await fetch('/api/provision-tenant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: summary.tenantId, orderId: summary.orderId, trial: true }),
      });
      if (!resp.ok) throw new Error(await resp.text());
      const data = await resp.json();
      const url = data?.successUrl || `/success?tenantId=${encodeURIComponent(summary.tenantId)}`;
      router.push(url);
    } catch (e: any) {
      setErr(e?.message || 'Trial provisioning failed.');
      setProvisioning(false);
    }
  }

  const paid = summary?.paymentStatus === 'paid';

  return (
    <div className="row justify-content-center">
      <div className="col-12 col-lg-8">
        <header className="mb-4 text-center">
          <h1 className="h4 fw-bold">Checkout</h1>
          <p className="text-muted">Review your details and complete your purchase to create your restaurant workspace.</p>
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
                    {paid ? <span className="badge bg-success ms-2">Paid</span> : <span className="text-muted">(payment pending)</span>}
                  </p>
                </div>

                {!paid && (
                  <div className="mb-3">
                    <h2 className="h6 fw-semibold">Pay with PayPal</h2>
                    <div id="paypal-buttons" />
                    <p className="small text-muted mt-2">
                      Secure payment via PayPal. You can use your PayPal balance or connected cards.
                    </p>
                  </div>
                )}
              </>
            ) : null}

            <div className="d-flex flex-column flex-md-row gap-2 mt-3">
              <Link href="/signup" className="btn btn-outline-secondary">
                Back
              </Link>

              {/* Create only enabled when payment is completed */}
              <button
                className="btn btn-primary flex-fill"
                onClick={createRestaurant}
                disabled={!summary || provisioning || !paid}
                title={!paid ? 'Complete payment to continue' : undefined}
              >
                {provisioning ? 'Creating…' : 'Create my restaurant'}
              </button>

              {/* 7-day trial path (no card) */}
              <button
                className="btn btn-outline-primary flex-fill"
                onClick={startTrial}
                disabled={!summary || provisioning}
              >
                Start 7-day free trial
              </button>
            </div>

            <p className="mt-3 text-center text-muted small">
              By continuing you agree to our <Link href="/terms">Terms</Link> and{' '}
              <Link href="/privacy">Privacy Policy</Link>.
            </p>
          </div>
        </div>

        <div className="alert alert-info mt-3 small">
          <strong>About trials:</strong> For the smoothest 7-day free trial with automatic billing on day 7, 
          the ideal setup is PayPal <em>Subscriptions</em> with a trial period. The current checkout uses 
          a one-time charge; the “Start 7-day free trial” button will provision without upfront payment 
          (your backend should set <code>trialEndsAt = now + 7 days</code> and enforce payment afterwards).
        </div>
      </div>
    </div>
  );
}
