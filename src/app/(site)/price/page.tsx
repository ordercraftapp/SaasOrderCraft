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
  description: string;
  monthlyPrice: number;
  yearlyPrice: number;
  features: string[];
  isPopular?: boolean;
  highlight?: boolean;
  ctaVariant?: string;
};

const PRICING_PLANS: PricingPlan[] = [
  {
    id: 'starter',
    name: 'Starter',
    description: 'Core tools to kick off',
    monthlyPrice: 19.99,
    yearlyPrice: Math.round(19.99 * 12 * 100) / 100, // sin descuento anual
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

// Reutilizable PriceCard con contexto anual/mensual
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
    <div className="col-lg-4 col-md-6 mb-4">
      <div className={cardClasses}>
        <div className="card-body p-4 p-md-5 d-flex flex-column">
          {plan.isPopular && (
            <span className="badge bg-warning text-dark position-absolute top-0 end-0 mt-n2 me-n2 p-2 fw-bold rounded-pill">
              Recomendado
            </span>
          )}

          <h3 className={`card-title fs-4 fw-bold mb-1 ${textClasses}`}>{plan.name}</h3>
          <p className={`card-text mb-4 ${plan.isPopular ? 'text-light' : 'text-muted'}`}>{plan.description}</p>

          <div className="mb-4">
            <span className="fw-bolder" style={{ fontSize: '3rem' }}>
              <sup className="fs-3 align-top">$</sup>
              {Number(price.toFixed(2))}
            </span>
            <span className={`fs-5 fw-normal ${plan.isPopular ? 'text-light' : 'text-muted'}`}>/{period}</span>
          </div>

          <ul className="list-unstyled flex-grow-1">
            {plan.features.map((feature, index) => (
              <li key={index} className="d-flex align-items-start mb-2">
                <Check
                  className={`h-5 w-5 flex-shrink-0 ${plan.isPopular ? 'text-warning' : 'text-success'} me-2`}
                  size={20}
                />
                <span className={plan.isPopular ? 'text-white' : 'text-dark'}>{feature}</span>
              </li>
            ))}
          </ul>

          <Link href={`/signup?plan=${plan.id}`} prefetch={false} className={btnClasses} aria-label={`Seleccionar ${plan.name}`}>
            {plan.isPopular ? 'Comenzar' : 'Seleccionar Plan'}
          </Link>
        </div>
      </div>
    </div>
  );
};

export default function PricingPage() {
  const [isAnnual, setIsAnnual] = useState<boolean>(true);

  return (
    <>
      <Header />
      <main>
        {/* Hero de la Página */}
        <section className="bg-light py-5">
          <div className="container text-center">
            <h1 className="display-5 fw-bold text-dark">Planes OrderCraft: Simples y Flexibles</h1>
            <p className="lead text-muted mx-auto" style={{ maxWidth: '800px' }}>
              Elige la mejor opción para el tamaño de tu restaurante. Sin contratos forzosos ni tarifas ocultas.
            </p>
            <div className="small text-success mt-2">7-day free trial — no credit card required</div>
          </div>
        </section>

        {/* Toggle Mensual/Anual */}
        <div className="d-flex justify-content-center pt-5">
          <div className="btn-group bg-light rounded-pill p-1" role="group">
            <button
              onClick={() => setIsAnnual(false)}
              className={`btn btn-sm rounded-pill px-4 ${!isAnnual ? 'btn-primary shadow' : 'btn-light text-muted'}`}
            >
              Mensual
            </button>
            <button
              onClick={() => setIsAnnual(true)}
              className={`btn btn-sm rounded-pill px-4 ${isAnnual ? 'btn-primary shadow' : 'btn-light text-muted'}`}
            >
              Anual
            </button>
          </div>
        </div>

        {/* Tabla de Precios */}
        <section className="py-5">
          <div className="container">
            <div className="row justify-content-center align-items-end">
              {PRICING_PLANS.map((plan) => (
                <PriceCard key={plan.id} plan={plan} isAnnual={isAnnual} />
              ))}
            </div>
          </div>
        </section>

        {/* Sección Adicional: Detalles de la Garantía */}
        <section className="bg-light py-5">
          <div className="container text-center">
            <h3 className="h4 fw-bold text-dark mb-3">Nuestra Garantía</h3>
            <p className="text-muted mx-auto" style={{ maxWidth: '700px' }}>
              Todos los planes incluyen una garantía de devolución de dinero de 30 días. Si OrderCraft no mejora la eficiencia
              de tu restaurante, te devolvemos tu dinero.
            </p>
          </div>
        </section>

        {/* Notes / FAQs (inspirado en la versión previa) */}
        <section className="mt-4">
          <div className="container">
            <div className="row justify-content-center">
              <div className="col-12 col-lg-10">
                <div className="p-3 p-md-4 rounded-3 border bg-light-subtle">
                  <div className="row">
                    <div className="col-12 col-md-6 mb-3 mb-md-0">
                      <h3 className="h6 fw-semibold">¿Qué pasa después del trial?</h3>
                      <p className="small text-muted mb-0">
                        Puedes continuar pagando mensualmente. Si no completas el pago después de 7 días, el acceso quedará en pausa hasta que
                        finalices el pago.
                      </p>
                    </div>
                    <div className="col-12 col-md-6">
                      <h3 className="h6 fw-semibold">¿Puedo cambiar de plan?</h3>
                      <p className="small text-muted mb-0">Sí. Puedes actualizar en cualquier momento; los cambios aplican al siguiente ciclo.</p>
                    </div>
                  </div>
                </div>

                <div className="text-center mt-4">
                  <p className="text-muted small mb-1">7-day free trial. Upgrade or cancel anytime.</p>
                  <p className="text-muted small mb-0">
                    Al continuar, aceptas nuestros <Link href="/terms">Terms</Link> y <Link href="/privacy">Privacy Policy</Link>.
                  </p>
                </div>
              </div>
            </div>
          </div>
        </section>

        <CtaBanner />
      </main>
      <Footer />
    </>
  );
}
