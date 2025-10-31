// components/homepage/PricingTable.tsx

'use client';

import React, { useState } from 'react';
import { PRICING_PLANS, PricingPlan } from '@/data/content';
import { Check } from 'lucide-react';

const PriceCard: React.FC<{ plan: PricingPlan; isAnnual: boolean }> = ({ plan, isAnnual }) => {
  const price = isAnnual ? plan.yearlyPrice : plan.monthlyPrice;
  const period = isAnnual ? 'yr' : 'mo';
  
  const cardClasses = plan.isPopular 
    ? "card text-white bg-primary shadow-lg border-0 h-100 transform-scale-105" // Clase personalizada para escala
    : "card border shadow-sm h-100";
  
  const btnClasses = plan.isPopular
    ? "btn btn-light fw-bold rounded-pill mt-4"
    : "btn btn-primary fw-bold rounded-pill mt-4";
    
  const textClasses = plan.isPopular ? 'text-white' : 'text-primary';

  return (
    <div className="col-lg-4 col-md-6 mb-4">
      <div className={cardClasses} style={{ transform: plan.isPopular ? 'scale(1.05)' : 'scale(1)' }}>
        <div className="card-body p-4 p-md-5 d-flex flex-column">
          {plan.isPopular && (
            <span className="badge bg-warning text-dark position-absolute top-0 end-0 mt-n2 me-n2 p-2 fw-bold rounded-pill">
              Most Popular
            </span>
          )}

          <h3 className={`card-title fs-4 fw-bold mb-1 ${textClasses}`}>
            {plan.name}
          </h3>
          <p className={`card-text mb-4 ${plan.isPopular ? 'text-light' : 'text-muted'}`}>
            {plan.description}
          </p>

          <div className="mb-4">
            <span className="fw-bolder" style={{ fontSize: '3rem' }}>
              <sup className="fs-3 align-top">$</sup>{price}
            </span>
            <span className={`fs-5 fw-normal ${plan.isPopular ? 'text-light' : 'text-muted'}`}>/{period}</span>
          </div>

          <ul className="list-unstyled flex-grow-1">
            {plan.features.map((feature, index) => (
              <li key={index} className="d-flex align-items-start mb-2">
                <Check className={`h-5 w-5 flex-shrink-0 ${plan.isPopular ? 'text-warning' : 'text-success'} me-2`} size={20} />
                <span className={plan.isPopular ? 'text-white' : 'text-dark'}>{feature}</span>
              </li>
            ))}
          </ul>

          <button className={btnClasses}>
            Select Plan
          </button>
        </div>
      </div>
    </div>
  );
};
 
export default function PricingTable() {
  const [isAnnual, setIsAnnual] = useState(true);

  return (
    <section className="py-5 py-md-5" id="pricing">
      <div className="container">
        <div className="text-center mb-5">
          <h2 className="display-6 fw-bold text-dark mb-3">Simple, Transparent Pricing</h2>
          <p className="lead text-muted mx-auto" style={{ maxWidth: '700px' }}>
            Choose the plan that fits your needs. No hidden fees, ever.
          </p>
        </div>

        {/* Toggle Mensual/Anual */}
        <div className="d-flex justify-content-center mb-5">
          <div className="btn-group bg-light rounded-pill p-1" role="group">
            <button
              onClick={() => setIsAnnual(false)}
              className={`btn btn-sm rounded-pill px-4 ${!isAnnual ? 'btn-primary shadow' : 'btn-light text-muted'}`}
            >
              Monthly
            </button>
            <button
              onClick={() => setIsAnnual(true)}
              className={`btn btn-sm rounded-pill px-4 ${isAnnual ? 'btn-primary shadow' : 'btn-light text-muted'}`}
            >
              Annual (Save up to 20%)
            </button>
          </div>
        </div>

        <div className="row justify-content-center align-items-end">
          {PRICING_PLANS.map((plan, index) => (
            <PriceCard key={index} plan={plan} isAnnual={isAnnual} />
          ))}
        </div>
      </div>
    </section>
  );
}