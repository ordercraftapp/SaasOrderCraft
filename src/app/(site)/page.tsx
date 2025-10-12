// src/app/(site)/page.tsx
import Link from 'next/link';

export default function PricingHomePage() {
  return (
    <main className="container py-5">
      {/* Header */}
      <div className="text-center">
        <h1 className="display-6 fw-semibold">Choose your plan</h1>
        <p className="lead text-muted mb-4">
          Start with a 14-day free trial. No credit card required.
        </p>
      </div>

      {/* Plans */}
      <div className="row row-cols-1 row-cols-md-3 g-4 mt-1">
        {/* Starter */}
        <div className="col">
          <div className="card h-100 border-0 shadow-sm">
            <div className="card-header bg-transparent border-0 pt-4 pb-0">
              <h2 className="h5 text-center mb-0">Starter</h2>
              <p className="text-center text-muted small mb-0">Core tools to kick off</p>
            </div>
            <div className="card-body">
              <div className="text-center mb-3">
                <span className="h2 fw-bold">$0</span>
                <span className="text-muted"> / trial</span>
              </div>
              <ul className="list-unstyled small">
                <li className="mb-2">✅ Kitchen</li>
                <li className="mb-2">✅ Cashier</li>
                <li className="mb-2">✅ Menu</li>
                <li className="mb-2">✅ Roles</li>
                <li className="mb-2">✅ Taxes</li>
                <li className="mb-2">✅ Settings (language/currency)</li>
                <li className="mb-2">✅ Home configure</li>
                <li className="mb-2">✅ Orders</li>
                <li className="mb-2">✅ Reports: Sales</li>
                <li className="mb-2">✅ Reports: Taxes</li>
                <li className="mb-2">✅ Reports: Product</li>
              </ul>
            </div>
            <div className="card-footer bg-transparent border-0 pb-4">
              <Link
                href="/signup?plan=starter"
                className="btn btn-outline-primary w-100"
              >
                Choose Starter
              </Link>
            </div>
          </div>
        </div>

        {/* Pro */}
        <div className="col">
          <div className="card h-100 border-primary shadow-sm">
            <div className="card-header bg-primary text-white py-3">
              <div className="d-flex justify-content-between align-items-center">
                <h2 className="h5 mb-0">Pro</h2>
                <span className="badge bg-light text-primary">Popular</span>
              </div>
              <p className="small mb-0 opacity-75">Growing restaurants</p>
            </div>
            <div className="card-body">
              <div className="text-center mb-3">
                <span className="h2 fw-bold">$—</span>
                <span className="text-muted"> / month</span>
              </div>
              <ul className="list-unstyled small">
                <li className="mb-2">✅ Everything in Starter</li>
                <li className="mb-2">✅ Waiter / Tables</li>
                <li className="mb-2">✅ Edit orders</li>
                <li className="mb-2">✅ Promotions</li>
                <li className="mb-2">✅ Reports: Clients</li>
                <li className="mb-2">✅ Reports: Promotions</li>
                <li className="mb-2">✅ Reports: Time</li>
              </ul>
            </div>
            <div className="card-footer bg-transparent border-0 pb-4">
              <Link
                href="/signup?plan=pro"
                className="btn btn-primary w-100"
              >
                Choose Pro
              </Link>
            </div>
          </div>
        </div>

        {/* Full */}
        <div className="col">
          <div className="card h-100 border-0 shadow-sm">
            <div className="card-header bg-transparent border-0 pt-4 pb-0">
              <h2 className="h5 text-center mb-0">Full</h2>
              <p className="text-center text-muted small mb-0">All-in for scale</p>
            </div>
            <div className="card-body">
              <div className="text-center mb-3">
                <span className="h2 fw-bold">$—</span>
                <span className="text-muted"> / month</span>
              </div>
              <ul className="list-unstyled small">
                <li className="mb-2">✅ Everything in Pro</li>
                <li className="mb-2">✅ Delivery</li>
                <li className="mb-2">✅ Delivery options</li>
                <li className="mb-2">✅ Ops</li>
                <li className="mb-2">✅ Marketing</li>
                <li className="mb-2">✅ AI Studio</li>
                <li className="mb-2">✅ Reports: Delivery</li>
                <li className="mb-2">✅ Reports: Cashier</li>
              </ul>
            </div>
            <div className="card-footer bg-transparent border-0 pb-4">
              <Link
                href="/signup?plan=full"
                className="btn btn-outline-primary w-100"
              >
                Choose Full
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Footnotes */}
      <div className="text-center mt-5">
        <p className="text-muted small mb-1">
          14-day free trial. Upgrade, downgrade, or cancel anytime.
        </p>
        <p className="text-muted small">
          By continuing, you agree to our{' '}
          <Link href="/terms">Terms</Link> and{' '}
          <Link href="/privacy">Privacy Policy</Link>.
        </p>
      </div>
    </main>
  );
}
