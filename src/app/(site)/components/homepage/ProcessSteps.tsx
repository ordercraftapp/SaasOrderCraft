// components/homepage/ProcessSteps.tsx

import React from 'react';
import { PROCESS_STEPS, ProcessStep } from '@/data/content';
import { ArrowRight } from 'lucide-react';

const StepCard: React.FC<{ step: ProcessStep; isLast: boolean }> = ({ step, isLast }) => (
  <div className="col-lg-4 text-center position-relative">
    {/* Contenedor de Paso */}
    <div className="d-flex flex-column align-items-center">
      {/* Círculo de Número */}
      <div className="bg-primary text-white rounded-circle d-flex align-items-center justify-content-center fw-bold fs-5 shadow-lg mb-3" style={{ width: '4rem', height: '4rem' }}>
        {step.number}
      </div>
      <h3 className="h5 fw-bold text-dark">{step.title}</h3>
      <p className="text-muted mt-2 px-3">{step.description}</p>
    </div>
    
    {/* Flecha Separadora (oculta en móvil y último paso) */}
    {!isLast && (
      <div className="position-absolute d-none d-lg-block" style={{ top: '20px', right: '-15%', transform: 'translateX(50%)' }}>
        <ArrowRight size={30} className="text-secondary opacity-50" />
      </div>
    )}
  </div>
);

export default function ProcessSteps() {
  return (
    <section className="py-5 py-md-5 bg-light" id="process">
      <div className="container">
        <div className="text-center mb-5">
          <h2 className="display-6 fw-bold text-dark mb-3">Your Restaurant in 3 Simple Steps</h2>
          <p className="lead text-muted mx-auto" style={{ maxWidth: '700px' }}>
            Simple setup. Powerful results. Built to grow your restaurant from day one.
          </p>
        </div>
        
        <div className="row justify-content-center position-relative">
          {PROCESS_STEPS.map((step, index) => (
            <StepCard key={step.number} step={step} isLast={index === PROCESS_STEPS.length - 1} />
          ))}
        </div>
      </div>
    </section>
  );
}