// src/app/(site)/success/successClient.tsx

'use client';

import { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';

type Summary = {
  tenantId: string;
  orderId: string;
  planTier: 'starter' | 'pro' | 'full'; // ← ahora planTier
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

export default function SuccessClient({ tenantId, orderId }: { tenantId: string; orderId: string }) {
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [err, setErr] = useState<string>('');

  const { adminUrl, appUrl, usingWildcard } = useMemo(() => {
    const baseDomain = (process.env.NEXT_PUBLIC_BASE_DOMAIN || 'datacraftcoders.cloud').toLowerCase();
    const supportsWildcard = process.env.NEXT_PUBLIC_USE_WILDCARD_SUBDOMAINS?.toLowerCase() !== 'false';

    const adminUrl = supportsWildcard
      ? `https://${tenantId}.${baseDomain}/admin`
      : `/${tenantId}/admin`;

    const appUrl = supportsWildcard
      ? `https://${tenantId}.${baseDomain}/app`
      : `/${tenantId}/app`;

    return { adminUrl, appUrl, usingWildcard: supportsWildcard };
  }, [tenantId]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        if (!tenantId || !orderId) {
          setErr('Missing tenantId or orderId.');
          setLoading(false);
          return;
        }
        const url = `/api/tenant-order?tenantId=${encodeURIComponent(tenantId)}&orderId=${encodeURIComponent(orderId)}`;
        const resp = await fetch(url, { cache: 'no-store' });
        if (!resp.ok) throw new Error(await resp.text());
        const data = (await resp.json()) as Summary;
        if (!cancelled) {
          setSummary(data);
          setErr('');
        }
      } catch (e: any) {
        if (!cancelled) setErr(e?.message || 'Failed to load order summary.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [tenantId, orderId]);

  if (!tenantId) {
    return (
      <main className="container py-5">
        <div className="row justify-content-center">
          <div className="col-12 col-lg-8">
            <div className="alert alert-danger">
              Missing <code>tenantId</code>. Please return to{' '}
              <Link href="/signup" className="alert-link">signup</Link>.
            </div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="container py-5">
      <div className="row justify-content-center">
        <div className="col-12 col-lg-8">
          <header className="text-center mb-4">
            <h1 className="h4 fw-bold">Your restaurant workspace is ready 🎉</h1>
            <p className="text-muted">
              Tenant <strong>{tenantId}</strong> has been provisioned successfully.
            </p>
          </header>

          <div className="card shadow-sm border-0 mb-3">
            <div className="card-body p-4">
              {loading ? (
                <p className="text-muted">Loading summary…</p>
              ) : err ? (
                <div className="alert alert-warning">
                  Could not load order summary. You can still access your panel below.
                </div>
              ) : summary ? (
                <>
                  <h2 className="h6 fw-semibold mb-3">Order summary</h2>

                  <div className="mb-2">
                    <div className="small text-muted">Plan</div>
                    <div className="text-capitalize">{summary.planTier}</div> {/* ← actualizado */}
                  </div>

                  <div className="mb-2">
                    <div className="small text-muted">Subdomain</div>
                    <div><strong>{summary.desiredSubdomain}</strong>.datacraftcoders.cloud</div>
                  </div>

                  <div className="mb-2">
                    <div className="small text-muted">Owner</div>
                    <div>{summary.customer?.name} — {summary.customer?.email}</div>
                  </div>

                  <div className="mb-2">
                    <div className="small text-muted">Company</div>
                    <div>{summary.company?.name}</div>
                    <div className="text-muted">
                      {summary.company?.address?.line1}
                      {summary.company?.address?.line2 ? `, ${summary.company.address.line2}` : ''}
                      {', '}
                      {summary.company?.address?.city}
                      {summary.company?.address?.region ? `, ${summary.company.address.region}` : ''}
                      {', '}
                      {summary.company?.address?.country}
                      {summary.company?.address?.postalCode ? ` ${summary.company.address.postalCode}` : ''}
                    </div>
                    {summary.company?.phone ? (
                      <div className="text-muted">Phone: {summary.company.phone}</div>
                    ) : null}
                  </div>

                  <div className="mb-0">
                    <div className="small text-muted">Amount</div>
                    <div>
                      {(summary.amountCents / 100).toFixed(2)} {summary.currency}{' '}
                      <span className="text-muted">(payment pending)</span>
                    </div>
                  </div>
                </>
              ) : null}
            </div>
          </div>

          <div className="card shadow-sm border-0">
            <div className="card-body p-4">
              <h2 className="h6 fw-semibold mb-2">Your links</h2>
              <div className="small">
                <div className="d-flex align-items-center justify-content-between border rounded p-2 mb-2">
                  <div>
                    <div className="fw-semibold">Admin panel</div>
                    <div className="text-muted text-truncate" style={{ maxWidth: 520 }}>
                      {adminUrl}
                    </div>
                  </div>
                  <Link href={adminUrl} className="btn btn-primary btn-sm">Go to Admin</Link>
                </div>

                <div className="d-flex align-items-center justify-content-between border rounded p-2">
                  <div>
                    <div className="fw-semibold">Customer app</div>
                    <div className="text-muted text-truncate" style={{ maxWidth: 520 }}>
                      {appUrl}
                    </div>
                  </div>
                  <Link href={appUrl} className="btn btn-outline-primary btn-sm">Open App</Link>
                </div>
              </div>

              {!usingWildcard ? (
                <div className="alert alert-info small mt-3 mb-0">
                  You are running without wildcard subdomains. Links use path format (
                  <code>/{tenantId}/...</code>). Set <code>NEXT_PUBLIC_USE_WILDCARD_SUBDOMAINS</code> to
                  <code>true</code> and configure DNS in Vercel to enable <code>{tenantId}.your-domain</code>.
                </div>
              ) : null}
            </div>
          </div>

          <p className="mt-3 text-center text-muted small">
            Need help? Visit our <Link href="/docs">Docs</Link> or <Link href="/support">Support</Link>.
          </p>
        </div>
      </div>
    </main>
  );
}
