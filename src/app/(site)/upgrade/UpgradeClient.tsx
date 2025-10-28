'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
    __effectiveUpgradeOrderId?: string | null;
  }
}

export default function UpgradeClient({ tenantId, orderId }: { tenantId: string; orderId: string }) {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [err, setErr] = useState<string>('');

  const [selectedPlan, setSelectedPlan] = useState<PlanId>('starter');
  const [paypalReady, setPaypalReady] = useState(false);
  const [renderedButtons, setRenderedButtons] = useState(false);

  const [resolvedOrderId, setResolvedOrderId] = useState<string>(orderId || '');
  const [debugOpen, setDebugOpen] = useState(false);

  // ref para la order interna efectiva (nueva o la existente) — se usa en create, capture y apply
  const effectiveOrderIdRef = useRef<string | null>(null);

  // Fallback: resolver orderId si no vino en props
  const resolveOrderIdIfNeeded = useCallback(async () => {
    if (!tenantId) {
      setErr('Missing tenantId.');
      return;
    }
    if (resolvedOrderId) return; // ya lo tenemos

    const url = `/api/upgrade/resolve-order?tenantId=${encodeURIComponent(tenantId)}`;
    try {
      const r = await fetch(url, { cache: 'no-store' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j?.orderId) {
        throw new Error(j?.error || 'Could not resolve an existing order for this tenant.');
      }
      setResolvedOrderId(j.orderId);
    } catch (e: any) {
      setErr(e?.message || 'Failed to resolve order for upgrade.');
    }
  }, [tenantId, resolvedOrderId]);

  const currency = (summary?.currency || 'USD').toUpperCase();
  const priceLabel = useMemo(() => {
    const cents = PLAN_PRICE_CENTS[selectedPlan] ?? 0;
    return `${(cents / 100).toFixed(2)} ${currency} / month`;
  }, [selectedPlan, currency]);

  const reloadSummary = useCallback(async () => {
    if (!tenantId) {
      setErr('Missing tenantId.');
      return;
    }
    const oid = resolvedOrderId || orderId;
    if (!oid) {
      await resolveOrderIdIfNeeded();
      return;
    }

    const url = `/api/tenant-order?tenantId=${encodeURIComponent(tenantId)}&orderId=${encodeURIComponent(oid)}`;
    try {
      const resp = await fetch(url, { cache: 'no-store' });
      if (!resp.ok) {
        const txt = await resp.text().catch(() => '');
        console.error('[UpgradeClient] GET summary failed', resp.status, txt);
        throw new Error(txt || `HTTP ${resp.status}`);
      }
      const data = (await resp.json()) as Summary;
      setSummary(data);
      setSelectedPlan((data.planTier as PlanId) || 'starter');
      setErr('');
    } catch (e: any) {
      setErr(e?.message || 'Failed to load summary.');
    }
  }, [tenantId, orderId, resolvedOrderId, resolveOrderIdIfNeeded]);

  // Orquestación de carga
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        if (!tenantId) {
          if (!cancelled) setErr('Missing tenantId.');
          return;
        }
        if (!resolvedOrderId && !orderId) {
          await resolveOrderIdIfNeeded();
        }
        await reloadSummary();
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || 'Failed to initialize upgrade.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tenantId, orderId, resolvedOrderId, resolveOrderIdIfNeeded, reloadSummary]);

  // Load PayPal SDK
  useEffect(() => {
    if (!summary) return;
    if (window.paypal) {
      setPaypalReady(true);
      return;
    }
    const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID;
    if (!clientId) {
      console.error('Missing NEXT_PUBLIC_PAYPAL_CLIENT_ID');
      return;
    }
    const scriptSrc = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=${encodeURIComponent(currency)}&intent=capture`;
    const script = document.createElement('script');
    script.src = scriptSrc;
    script.async = true;
    script.onload = () => {
      setPaypalReady(true);
    };
    script.onerror = () => {
      setErr('Failed to load PayPal SDK.');
      console.error('[UpgradeClient] PayPal SDK failed to load');
    };
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
      console.error('[UpgradeClient] window.paypal.Buttons not available');
      return;
    }

    const buttons = window.paypal.Buttons({
      style: { layout: 'vertical', shape: 'pill', label: 'pay' },

      // 1) Antes de crear la orden de PayPal, actualizamos la MISMA orden interna
      createOrder: async () => {
        try {
          if (!summary) throw new Error('Missing order summary.');

          // 1) Pedimos al backend preparar la orden para este upgrade.
          const updateResp = await fetch('/api/upgrade/use-existing-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tenantId: summary.tenantId,
              orderId: summary.orderId,
              newPlan: selectedPlan,
            }),
          });
          const updateJson = await updateResp.json().catch(() => ({}));
          if (!updateResp.ok) {
            console.error('[UpgradeClient] use-existing-order failed:', updateResp.status, updateJson);
            throw new Error(updateJson?.error || 'Failed to update order for upgrade.');
          }

          // Si el backend creó/retornó una nueva orderId, úsala
          const effectiveOrderId = updateJson?.orderId || summary.orderId;
          effectiveOrderIdRef.current = effectiveOrderId;
          window.__effectiveUpgradeOrderId = effectiveOrderId;

          // 2) Crear la orden de PayPal para ESA orden interna efectiva
          // -> pasamos amountCents para forzar monto esperado (reduce race conditions)
          const resp = await fetch('/api/paypal/create-order', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              tenantId: summary.tenantId,
              orderId: effectiveOrderId,
              amountCents: PLAN_PRICE_CENTS[selectedPlan],
              currency: (summary.currency || 'USD').toUpperCase(),
              description: `Upgrade to ${selectedPlan} for ${summary.tenantId}`,
              selectedPlan,
            }),
          });
          const json = await resp.json().catch(() => ({}));

          const paypalOrderId =
            json?.paypalOrderId ??
            json?.id ??
            json?.orderID ??
            json?.result?.id;

          if (!resp.ok || !paypalOrderId) {
            console.error('[UpgradeClient] PayPal create-order failed:', resp.status, json);
            throw new Error(json?.error || 'Could not create PayPal order.');
          }

          // (opcional) si backend devolvió amountCents, podrías actualizar summary local o mostrar al usuario
          // if (json?.amountCents) { /* actualizar UI si quieres */ }

          return paypalOrderId;
        } catch (e: any) {
          setErr(e?.message || 'Could not prepare PayPal order.');
          throw e;
        }
      },

      onApprove: async (data: any) => {
        try {
          const paypalOrderId = data?.orderID;
          if (!paypalOrderId) throw new Error('Missing PayPal order ID.');

          // Usa la effectiveOrderId guardada — si no existe, cae a summary.orderId
          const effectiveOrderId = effectiveOrderIdRef.current || summary.orderId;

          // 3) Capturar pago usando la order interna efectiva
          const resp = await fetch('/api/paypal/capture', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tenantId: summary.tenantId, orderId: effectiveOrderId, paypalOrderId }),
          });
          const json = await resp.json().catch(() => ({}));
          if (!resp.ok || !json?.ok) {
            console.error('[UpgradeClient] capture failed:', resp.status, json);
            throw new Error(json?.error || 'Payment capture failed.');
          }

          // 4) Aplicar upgrade usando la misma order interna efectiva
          const applyResp = await fetch('/api/upgrade/apply', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ tenantId: summary.tenantId, orderId: effectiveOrderId }),
          });
          const applyJson = await applyResp.json().catch(() => ({}));
          if (!applyResp.ok) {
            console.error('[UpgradeClient] apply failed:', applyResp.status, applyJson);
            throw new Error(applyJson?.error || 'Failed to apply upgrade.');
          }

          const url = applyJson?.successUrl || `/success?tenantId=${encodeURIComponent(summary.tenantId)}&orderId=${encodeURIComponent(effectiveOrderId)}`;
          window.location.assign(url);
        } catch (e: any) {
          setErr(e?.message || 'Payment processing failed.');
        }
      },

      onCancel: () => {
        // user cancelled
      },

      onError: (err: any) => {
        setErr(err?.message || 'PayPal error.');
        console.error('[UpgradeClient] PayPal onError:', err);
      },
    });

    buttons.render(`#${containerId}`);
    setRenderedButtons(true);
    // no cleanup por ahora
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paypalReady, summary, renderedButtons, selectedPlan]);

  // Cuando el usuario cambia de plan, marcar que necesitamos re-renderizar los botones
  const handlePlanChange = (v: PlanId) => {
    setSelectedPlan(v);
    // fuerza re-render del SDK buttons para que cree orden con el nuevo monto
    setRenderedButtons(false);
    // limpia error previo
    setErr('');
  };

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

        {/* 🔎 Panel de debug opcional */}
        <div className="d-flex justify-content-end mb-2">
          <button className="btn btn-link btn-sm" onClick={() => setDebugOpen(v => !v)}>
            {debugOpen ? 'Hide debug' : 'Show debug'}
          </button>
        </div>
        {debugOpen && (
          <div className="alert alert-secondary small">
            <div><strong>Props</strong> tenantId: <code>{tenantId || '(empty)'}</code> — orderId (prop): <code>{orderId || '(empty)'}</code></div>
            <div><strong>resolvedOrderId</strong>: <code>{resolvedOrderId || '(empty)'}</code></div>
            <div><strong>Summary?</strong> {summary ? 'yes' : 'no'}</div>
            {summary && (
              <>
                <div>summary.tenantId: <code>{summary.tenantId}</code></div>
                <div>summary.orderId: <code>{summary.orderId}</code></div>
                <div>summary.planTier: <code>{summary.planTier}</code></div>
                <div>summary.currency: <code>{summary.currency}</code></div>
              </>
            )}
            <div>effectiveOrderIdRef: <code>{effectiveOrderIdRef.current ?? '(empty)'}</code></div>
            {err && <div className="text-danger mt-2">Error: {err}</div>}
          </div>
        )}

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
                        onChange={(e) => handlePlanChange(e.target.value as PlanId)}
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
            ) : (
              <div className="alert alert-warning">
                We could not find an existing order for this workspace. Please contact support.
              </div>
            )}

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
