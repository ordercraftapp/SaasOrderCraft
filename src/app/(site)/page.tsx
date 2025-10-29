// src/app/(site)/page.tsx
import Link from 'next/link';

export default function PricingHomePage() {
  const plans = [
    {
      id: 'starter',
      name: 'Starter',
      tagline: 'Core tools to kick off',
      price: 19.99,
      popular: false,
      highlight: false,
      features: [
        'Kitchen',
        'Cashier',
        'Menu',
        'Roles',
        'Taxes',
        'Settings (language/currency)',
        'Home configure',
        'Orders',
        'Reports: Sales',
        'Reports: Taxes',
        'Reports: Product',
      ],
      ctaVariant: 'outline-primary',
    },
    {
      id: 'pro',
      name: 'Pro',
      tagline: 'Growing restaurants',
      price: 29.99,
      popular: true,
      highlight: true, // estilo destacado
      features: [
        'Everything in Starter',
        'Waiter / Tables',
        'Edit orders',
        'Promotions',
        'Reports: Clients',
        'Reports: Promotions',
        'Reports: Time',
      ],
      ctaVariant: 'primary',
    },
    {
      id: 'full',
      name: 'Full',
      tagline: 'All-in for scale',
      price: 34.99,
      popular: false,
      highlight: false,
      features: [
        'Everything in Pro',
        'Delivery',
        'Delivery options',
        'Ops',
        'Marketing',
        'AI Studio',
        'Reports: Delivery',
        'Reports: Cashier',
      ],
      ctaVariant: 'outline-primary',
    },
  ] as const;

  return (
    <main className="container py-5">
      {/* Hero */}
      <section className="text-center mb-5">
        <span className="badge rounded-pill text-dark text-bg-primary-subtle border border-primary-subtle px-3 py-2">
          7-day free trial — no credit card required
        </span>
        <h1 className="display-6 fw-semibold mt-3">Choose your plan</h1>
        <p className="lead text-muted mb-0">
          Simple monthly pricing. Upgrade or cancel anytime.
        </p>
      </section>

      {/* Plans grid */}
      <section>
        <div className="row row-cols-1 row-cols-md-3 g-4">
          {plans.map((p) => (
            <div className="col" key={p.id}>
              <div
                className={[
                  'card h-100 shadow-sm',
                  p.highlight ? 'border-primary' : 'border-0',
                ].join(' ')}
              >
                {/* Header */}
                {p.highlight ? (
                  <div className="card-header bg-primary text-white py-3 border-0">
                    <div className="d-flex justify-content-between align-items-center">
                      <h2 className="h5 mb-0">{p.name}</h2>
                      {p.popular && (
                        <span className="badge bg-light text-primary">Popular</span>
                      )}
                    </div>
                    <p className="small mb-0 opacity-75">{p.tagline}</p>
                  </div>
                ) : (
                  <div className="card-header bg-transparent border-0 pt-4 pb-0">
                    <h2 className="h5 text-center mb-0">{p.name}</h2>
                    <p className="text-center text-muted small mb-0">{p.tagline}</p>
                  </div>
                )}

                {/* Price */}
                <div className="card-body">
                  <div className="text-center mb-3">
                    <div className="d-inline-flex align-items-end gap-1">
                      <span className="display-6 fw-bold">${p.price.toFixed(2)}</span>
                      <span className="text-muted mb-2">/ month</span>
                    </div>
                    <div className="small text-success mt-1">
                      7-day free trial included
                    </div>
                  </div>

                  {/* Features */}
                  <ul className="list-unstyled small mb-0">
                    {p.features.map((f, i) => (
                      <li className="mb-2 d-flex align-items-start" key={i}>
                        <span
                          className="me-2 rounded-circle bg-success-subtle text-success d-inline-flex align-items-center justify-content-center"
                          style={{ width: 20, height: 20, fontSize: 12 }}
                          aria-hidden
                        >
                          ✓
                        </span>
                        <span>{f}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* CTA */}
                <div className="card-footer bg-transparent border-0 pb-4 pt-0">
                  <Link
                    href={`/signup?plan=${p.id}`}
                    className={`btn btn-${p.ctaVariant} w-100`}
                    prefetch={false}
                  >
                    Choose {p.name} 
                  </Link>
                  <div className="text-center small text-muted mt-2">
                    7-day free trial. Cancel anytime
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* FAQs / Notes */}
      <section className="mt-5">
        <div className="row justify-content-center">
          <div className="col-12 col-lg-10">
            <div className="p-3 p-md-4 rounded-3 border bg-light-subtle">
              <div className="row">
                <div className="col-12 col-md-6 mb-3 mb-md-0">
                  <h3 className="h6 fw-semibold">What happens after the trial?</h3>
                  <p className="small text-muted mb-0">
                    You can continue by paying monthly via PayPal.
                    If you don’t pay after 7 days, access will be paused until you complete payment.
                  </p>
                </div>
                <div className="col-12 col-md-6">
                  <h3 className="h6 fw-semibold">Can I switch plans?</h3>
                  <p className="small text-muted mb-0">
                    Yes. You can upgrade at anytime; changes apply to the next cycle.
                  </p>
                </div>
              </div>
            </div>

            {/* Legal */}
            <div className="text-center mt-4">
              <p className="text-muted small mb-1">
                7-day free trial. Upgrade or cancel anytime.
              </p>
              <p className="text-muted small mb-0">
                By continuing, you agree to our{' '}
                <Link href="/terms">Terms</Link> and{' '}
                <Link href="/privacy">Privacy Policy</Link>.
              </p>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
