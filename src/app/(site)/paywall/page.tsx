'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import Link from 'next/link';

declare global { interface Window { paypal?: any; } }

export default function PaywallPage() {
  const sp = useSearchParams();

  const tenantId = sp.get('tenantId') || '';
  const ret = sp.get('return') || `/${tenantId}/app`;
  const plan = (sp.get('plan') || 'starter') as 'starter' | 'pro' | 'full';
  const amountCents = Number(sp.get('amountCents') || '0');
  const currency = (sp.get('currency') || 'USD').toUpperCase();

  const [err, setErr] = useState('');
  const [paypalReady, setPaypalReady] = useState(false);
  const [rendered, setRendered] = useState(false);

  const amount = useMemo(() => (amountCents / 100).toFixed(2), [amountCents]);

  // Cargar SDK
  useEffect(() => {
    if (window.paypal) { setPaypalReady(true); return; }
    const clientId = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID;
    if (!clientId) { setErr('Missing NEXT_PUBLIC_PAYPAL_CLIENT_ID'); return; }
    const s = document.createElement('script');
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=${encodeURIComponent(currency)}&intent=capture`;
    s.async = true;
    s.onload = () => setPaypalReady(true);
    s.onerror = () => setErr('Failed to load PayPal SDK');
    document.body.appendChild(s);
  }, [currency]);

  // Render botones
  useEffect(() => {
    if (!paypalReady || rendered || !tenantId) return;
    const c = document.getElementById('paypal-site-paywall');
    if (!c || !window.paypal?.Buttons) return;

    const btns = window.paypal.Buttons({
      style: { layout: 'vertical', shape: 'pill', label: 'pay' },
      createOrder: async () => {
        const r = await fetch('/api/paypal/create-order', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tenantId, orderId: undefined }), // si quieres forzar una orden específica, pásala aquí
        });
        const j = await r.json();
        if (!r.ok || !j?.paypalOrderId) throw new Error(j?.error || 'Create order failed');
        return j.paypalOrderId;
      },
      onApprove: async (data: any) => {
        const paypalOrderId = data?.orderID;
        if (!paypalOrderId) return;
        // Necesitamos saber qué orderId capturar; si el checker te lo pasó, inclúyelo en el query
        const orderId = sp.get('orderId') || ''; // opcional: añade en middleware si quieres precisión
        const body = orderId ? { tenantId, orderId, paypalOrderId } : { tenantId, paypalOrderId };
        // Si no pasas orderId, tu /capture debe resolver cuál es la “pendiente” del tenant
        const r = await fetch('/api/paypal/capture', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const j = await r.json();
        if (!r.ok || !j?.ok) throw new Error(j?.error || 'Capture failed');
        // Pago OK → volver a la ruta original
        window.location.href = ret;
      },
      onError: (e: any) => setErr(e?.message || 'PayPal error'),
    });

    btns.render('#paypal-site-paywall');
    setRendered(true);
  }, [paypalReady, rendered, tenantId, sp, ret]);

  return (
    <main className="container py-5">
      <div className="row justify-content-center">
        <div className="col-12 col-lg-8">
          <div className="text-center mb-4">
            <h1 className="h4 fw-bold">Your trial has ended</h1>
            <p className="text-muted">Complete your payment to continue using the app.</p>
          </div>

          <div className="card border-0 shadow-sm">
            <div className="card-body p-4">
              {err && <div className="alert alert-danger">{err}</div>}

              <div className="mb-3">
                <div className="small text-muted">Tenant</div>
                <div><strong>{tenantId}</strong></div>
              </div>

              <div className="mb-3">
                <div className="small text-muted">Plan</div>
                <div className="text-capitalize">{plan}</div>
              </div>

              <div className="mb-3">
                <div className="small text-muted">Amount due</div>
                <div>{amount} {currency}</div>
              </div>

              <div className="mb-2">
                <h2 className="h6 fw-semibold">Pay with PayPal</h2>
                <div id="paypal-site-paywall" />
              </div>

              <p className="small text-muted mb-0">
                Access will be restored immediately after payment.
              </p>

              <div className="text-center mt-3">
                <Link href={ret} className="btn btn-link btn-sm">Back</Link>
              </div>
            </div>
          </div>

          <p className="mt-3 text-center text-muted small">
            Need help? <Link href="/support">Contact support</Link>
          </p>
        </div>
      </div>
    </main>
  );
}
