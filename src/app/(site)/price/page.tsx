'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import Header from '@/app/(site)/components/homepage/Header';
import CtaBanner from '@/app/(site)/components/homepage/CtaBanner';
import Footer from '@/app/(site)/components/homepage/Footer';
import { Check } from 'lucide-react';

type PricingPlan = {
  id: string;
  name: string;
  description: string; // usamos 'tagline' del original como description
  monthlyPrice: number;
  yearlyPrice: number;
  features: string[];
  isPopular?: boolean;
  highlight?: boolean;
  ctaVariant?: string;
};

// Tomamos los planes y los adaptamos al shape de PricingPlan (sin descuento anual)
const PRICING_PLANS: PricingPlan[] = [
  {
    id: 'starter',
    name: 'Starter',
    description: 'Core tools to kick off',
    monthlyPrice: 19.99,
    yearlyPrice: Math.round(19.99 * 12 * 100) / 100,
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
    isPopular: false,
    highlight: false,
    ctaVariant: 'outline-primary',
  },
  {
    id: 'pro',
    name: 'Pro',
    description: 'Growing restaurants',
    monthlyPrice: 29.99,
    yearlyPrice: Math.round(29.99 * 12 * 100) / 100,
    features: [
      'Everything in Starter',
      'Waiter / Tables',
      'Edit orders',
      'Promotions',
      'Reports: Clients',
      'Reports: Promotions',
      'Reports: Time',
    ],
    isPopular: true,
    highlight: true,
    ctaVariant: 'primary',
  },
  {
    id: 'full',
    name: 'Full',
    description: 'All-in for scale',
    monthlyPrice: 34.99,
    yearlyPrice: Math.round(34.99 * 12 * 100) / 100,
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
    isPopular: false,
    highlight: false,
    ctaVariant: 'outline-primary',
  },
];

// Reutilizable PriceCard (estilo tomado del app/pricing/page.tsx)
const PriceCard: React.FC<{ plan: PricingPlan; isAnnual: boolean }> = ({ plan, isAnnual }) => {
  const price = isAnnual ? plan.yearlyPrice : plan.monthlyPrice;
  const period = isAnnual ? 'yr' : 'mo';

  const cardClasses = plan.isPopular
    ? 'card text-white bg-primary shadow-lg border-0 h-100 position-relative'
    : 'card border shadow-sm h-100';

  const btnClasses = plan.isPopular
    ? 'btn btn-light fw-bold rounded-pill mt-4'
    : 'btn btn-primary fw-bold rounded-pill mt-4';

  const textClasses = plan.isPopular ? 'text-white' : 'text-primary';

  return (
    <div className="col">
      <div className={['card h-100', plan.highlight ? 'border-primary shadow-sm' : 'border-0 shadow-sm'].join(' ')}>
        {plan.highlight ? (
          <div className="card-header bg-primary text-white py-3 border-0">
            <div className="d-flex justify-content-between align-items-center">
              <h2 className="h5 mb-0">{plan.name}</h2>
              {plan.isPopular && <span className="badge bg-light text-primary">Popular</span>}
            </div>
            <p className="small mb-0 opacity-75">{plan.description}</p>
          </div>
        ) : (
          <div className="card-header bg-transparent border-0 pt-4 pb-0">
            <h2 className="h5 text-center mb-0">{plan.name}</h2>
            <p className="text-center text-muted small mb-0">{plan.description}</p>
          </div>
        )}

        {/* Cuerpo con estilo de PriceCard */}
        <div className="card-body p-4 p-md-5 d-flex flex-column">
          {/* Si queremos el badge 'Recomendado' en isPopular como en style original */}
          {plan.isPopular && (
            <span className="badge bg-warning text-dark position-absolute top-0 end-0 mt-n2 me-n2 p-2 fw-bold rounded-pill">
              Recomendado
            </span>
          )}

          {/* Precio centrado siguiendo style */}
          <div className="text-center mb-3">
            <div className="d-inline-flex align-items-end gap-1">
              <span className="display-6 fw-bold">${(plan.monthlyPrice).toFixed(2)}</span>
              <span className="text-muted mb-2">/ month</span>
            </div>
            <div className="small text-success mt-1">7-day free trial included</div>
          </div>

          {/* Lista de features con Check (como style) */}
          <ul className="list-unstyled flex-grow-1">
            {plan.features.map((feature, idx) => (
              <li key={idx} className="d-flex align-items-start mb-2">
                <Check className={`h-5 w-5 flex-shrink-0 ${plan.isPopular ? 'text-warning' : 'text-success'} me-2`} size={18} />
                <span className={plan.isPopular ? 'text-white' : 'text-dark'}>{feature}</span>
              </li>
            ))}
          </ul>

          {/* CTA en footer-like */}
          <div className="mt-3">
            <Link href={`/signup?plan=${plan.id}`} prefetch={false} className={btnClasses} aria-label={`Choose ${plan.name}`}>
              {plan.isPopular ? `Choose ${plan.name}` : `Choose ${plan.name}`}
            </Link>
            <div className="text-center small text-muted mt-2">7-day free trial. Cancel anytime</div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default function PricingPage() {
  const [isAnnual, setIsAnnual] = useState<boolean>(false); // por defecto mensual para que refleje el precio visible en cards

  return (
    <>
      <Header />
      <main className="container py-5">
        {/* Hero (mantengo contenido del primer archivo) */}
        <section className="text-center mb-5">
          <span className="badge rounded-pill text-dark text-bg-primary-subtle border border-primary-subtle px-3 py-2">
            7-day free trial — no credit card required
          </span>
          <h1 className="display-6 fw-semibold mt-3">Choose your plan</h1>
          <p className="lead text-muted mb-0">Simple monthly pricing. Upgrade or cancel anytime.</p>
        </section>

        {/* Toggle Mensual/Anual (estética del segundo) */}
        <div className="d-flex justify-content-center pt-4 pb-3">
          <div className="btn-group bg-light rounded-pill p-1" role="group">
            <button
              onClick={() => setIsAnnual(false)}
              className={`btn btn-sm rounded-pill px-4 ${!isAnnual ? 'btn-primary shadow' : 'btn-light text-muted'}`}
              type="button"
            >
              Mensual
            </button>
            <button
              onClick={() => setIsAnnual(true)}
              className={`btn btn-sm rounded-pill px-4 ${isAnnual ? 'btn-primary shadow' : 'btn-light text-muted'}`}
              type="button"
            >
              Anual
            </button>
          </div>
        </div>

        {/* Plans grid: usamos el layout original (row-cols) pero renderizamos PriceCard que contiene el estilo fusionado */}
        <section>
          <div className="row row-cols-1 row-cols-md-3 g-4">
            {PRICING_PLANS.map((p) => (
              <PriceCard key={p.id} plan={p} isAnnual={isAnnual} />
            ))}
          </div>
        </section>

        {/* FAQs / Notes (del primer archivo) */}
        <section className="mt-5">
          <div className="row justify-content-center">
            <div className="col-12 col-lg-10">
              <div className="p-3 p-md-4 rounded-3 border bg-light-subtle">
                <div className="row">
                  <div className="col-12 col-md-6 mb-3 mb-md-0">
                    <h3 className="h6 fw-semibold">What happens after the trial?</h3>
                    <p className="small text-muted mb-0">
                      You can continue by paying monthly via PayPal. If you don’t pay after 7 days, access will be paused until you complete payment.
                    </p>
                  </div>
                  <div className="col-12 col-md-6">
                    <h3 className="h6 fw-semibold">Can I switch plans?</h3>
                    <p className="small text-muted mb-0">Yes. You can upgrade at anytime; changes apply to the next cycle.</p>
                  </div>
                </div>
              </div>

              {/* Legal */}
              <div className="text-center mt-4">
                <p className="text-muted small mb-1">7-day free trial. Upgrade or cancel anytime.</p>
                <p className="text-muted small mb-0">
                  By continuing, you agree to our <Link href="/terms">Terms</Link> and <Link href="/privacy">Privacy Policy</Link>.
                </p>
              </div>
            </div>
          </div>
        </section>

        {/* Garantía / Sección extra con estilo del segundo file */}
        <section className="bg-light py-5 mt-4">
          <div className="container text-center">
            <h3 className="h4 fw-bold text-dark mb-3">Nuestra Garantía</h3>
            <p className="text-muted mx-auto" style={{ maxWidth: '700px' }}>
              Todos los planes incluyen una garantía de devolución de dinero de 30 días. Si OrderCraft no mejora la eficiencia de tu restaurante, te devolvemos tu dinero.
            </p>
          </div>
        </section>

        <CtaBanner />
      </main>
      <Footer />
    </>
  );
}
