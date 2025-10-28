'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

type PlanId = 'starter' | 'pro' | 'full';

const PLAN_PRICE_CENTS: Record<PlanId, number> = {
  starter: 1999,
  pro: 2999,
  full: 3499,
};

type Summary = {
  tenantId: string;
  orderId: string;
  planTier: PlanId;
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
  currency: string; // e.g. "USD"
  paymentStatus: 'pending' | 'paid' | 'failed';
  orderStatus: 'created' | 'provisioned' | 'cancelled';
  createdAt?: unknown;
};

declare global {
  interface Window {
    paypal?: any;
  }
}

export default function UpgradeClient({ tenantId, orderId }: { tenantId: string; orderId: string }) {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [err, setErr] = useState<string>('');

  const [selectedPlan, setSelectedPlan] = useState<PlanId>('starter');
  const [paypalReady, setPaypalReady] = useState(false);
  const [renderedButtons, setRenderedButtons] = useState(false);

  const currency = (summary?.currency || 'USD').toUpperCase();
  const priceLabel = useMemo(() => {
    const cents = PLAN_PRICE_CENTS[selectedPlan] ?? 0;
    return `${(cents / 100).toFixed(2)} ${currency} / month`;
  }, [selectedPlan, currency]);

  const reloadSummary = useCallback(async () => {
    if (!tenantId || !orderId) return;
    const url = `/api/tenant-order?tenantId=${encodeURIComponent(tenantId)}&orderId=${encodeURIComponent(orderId)}`;
    const resp = await fetch(url, { cache: 'no-store' });
    if (!resp.ok) throw new Error(await resp.text());
    const data = (await resp.json()) as Summary;
    setSummary(data);
    setSelectedPlan(data.planTier || 'starter');
    setErr('');
  }, [tenantId, orderId]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!tenantId || !orderId) {
          if (!cancelled) setErr('Missing tenantId or orderId.');
          return;
        }
        await reloadSummary();
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || 'Failed to load summary.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tenantId, orderId, reloadSummary]);

  // Load PayPal SDK
  useEffect(() => {
    if (!summary) return;
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
    const script = document.createElement('script');
    script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=${encodeURIComponent(currency)}&intent=capture`;
    script.async = true;
    script.onload = () => setPaypalReady(true);
    script.onerror = () => setErr('Failed to load PayPal SDK.');
    document.body.appendChild(script);
  }, [summary, currency]);

  // Render PayPal Buttons
  useEffect(() => {
    if (!paypalReady || !summary) return;
    if (renderedButtons) return;

    const containerId = 'paypal-buttons-upgrade';
    const container = document.getElementById(containerId);
    if (!container) return;

    if (!window.paypal || !window.paypal.Buttons) {
      setErr('PayPal Buttons not available.');
      return;
    }

    const buttons = window.paypal.Buttons({
      style: { layout: 'vertical', shape: 'pill', label: 'pay' },

      // 1) Antes de crear la orden de PayPal, actualizamos la MISMA orden interna con el nuevo plan/monto (type: 'upgrade')
      createOrder: async () => {
        try {
          if (!summary) throw new Error('Missing order summary.');
          const updateResp = await fetch('/api/upgrade/use-existing-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tenantId: summary.tenantId,
              orderId: summary.orderId,
              newPlan: selectedPlan,
            }),
          });
          const updateJson = await updateResp.json();
          if (!updateResp.ok) throw new Error(updateJson?.error || 'Failed to update order for upgrade.');

          // 2) Crear PayPal order (usa el mirror plano tenantOrders/${tenantId}__${orderId})
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
          setErr(e?.message || 'Could not prepare PayPal order.');
          throw e;
        }
      },

      onApprove: async (data: any) => {
        try {
          const paypalOrderId = data?.orderID;
          if (!paypalOrderId) throw new Error('Missing PayPal order ID.');

          // 3) Capturar pago
          const resp = await fetch('/api/paypal/capture', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tenantId: summary.tenantId, orderId: summary.orderId, paypalOrderId }),
          });
          const json = await resp.json();
          if (!resp.ok || !json?.ok) {
            throw new Error(json?.error || 'Payment capture failed.');
          }

          // 4) Aplicar upgrade (actualizar planTier, features, flags)
          const applyResp = await fetch('/api/upgrade/apply', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tenantId: summary.tenantId, orderId: summary.orderId }),
          });
          const applyJson = await applyResp.json();
          if (!applyResp.ok) {
            throw new Error(applyJson?.error || 'Failed to apply upgrade.');
          }

          // Redirigir a success (reutilizamos tu success page)
          const url = applyJson?.successUrl || `/success?tenantId=${encodeURIComponent(summary.tenantId)}&orderId=${encodeURIComponent(summary.orderId)}`;
          window.location.assign(url);
        } catch (e: any) {
          setErr(e?.message || 'Payment processing failed.');
        }
      },

      onCancel: () => {
        // opcional
      },

      onError: (err: any) => {
        setErr(err?.message || 'PayPal error.');
      },
    });

    buttons.render(`#${containerId}`);
    setRenderedButtons(true);
    // no cleanup
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paypalReady, summary, renderedButtons, selectedPlan]);

  const samePlan = summary && selectedPlan === summary.planTier;

  return (
    <div className="row justify-content-center">
      <div className="col-12 col-lg-8">
        <header className="mb-4 text-center">
          <h1 className="h4 fw-bold">Upgrade plan</h1>
          <p className="text-muted">
            Choose your new plan and complete the payment to apply it to your workspace.
          </p>
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
                  <h2 className="h6 fw-semibold">Tenant</h2>
                  <p className="mb-0"><strong>{summary.tenantId}</strong>.datacraftcoders.cloud</p>
                </div>

                <div className="mb-3">
                  <h2 className="h6 fw-semibold">Current plan</h2>
                  <p className="mb-0 text-capitalize">{summary.planTier}</p>
                </div>

                <div className="mb-3">
                  <h2 className="h6 fw-semibold">Select new plan</h2>
                  <div className="row g-2">
                    <div className="col-12 col-md-6">
                      <select
                        className="form-select"
                        value={selectedPlan}
                        onChange={(e) => setSelectedPlan(e.target.value as PlanId)}
                      >
                        <option value="starter">Starter — $19.99</option>
                        <option value="pro">Pro — $29.99</option>
                        <option value="full">Full — $34.99</option>
                      </select>
                    </div>
                    <div className="col-12 col-md-6">
                      <div className="form-text">
                        You’ll pay today: <strong>{priceLabel}</strong>
                      </div>
                    </div>
                  </div>
                  {samePlan ? (
                    <div className="small text-warning mt-2">You already have this plan selected.</div>
                  ) : null}
                </div>

                <div className="mb-3">
                  <h2 className="h6 fw-semibold">Pay with PayPal</h2>
                  <div id="paypal-buttons-upgrade" />
                  <p className="small text-muted mt-2">
                    Secure payment via PayPal. After payment, your plan will be updated automatically.
                  </p>
                </div>
              </>
            ) : null}

            <div className="d-flex gap-2 mt-3">
              <Link href="/docs" className="btn btn-outline-secondary">Help</Link>
              <Link href="/support" className="btn btn-outline-secondary">Contact support</Link>
            </div>
          </div>
        </div>

        <div className="alert alert-info mt-3 small">
          This upgrade flow uses one-time PayPal charges. To enable automatic monthly billing,
          we can later migrate to PayPal <em>Subscriptions</em>.
        </div>
      </div>
    </div>
  );
}
