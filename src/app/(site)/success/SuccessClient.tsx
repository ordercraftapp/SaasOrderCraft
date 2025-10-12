// src/app/(site)/success/SuccessClient.tsx
'use client';

import { useMemo } from 'react';
import Link from 'next/link';

export default function SuccessClient({ tenantId }: { tenantId: string }) {

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
              Tenant <strong>{tenantId}</strong> has been provisioned. You can go to your admin panel now.
            </p>
          </header>

          <div className="card shadow-sm border-0">
            <div className="card-body p-4">
              <div className="mb-3">
                <h2 className="h6 fw-semibold mb-2">Next steps</h2>
                <ul className="small text-muted mb-0">
                  <li>Open your admin panel and sign in.</li>
                  <li>Set your language, currency and taxes in <em>Settings</em>.</li>
                  <li>Create categories and add your first menu items.</li>
                  <li>Invite your team and assign roles.</li>
                </ul>
              </div>

              <div className="mb-3">
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
