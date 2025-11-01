// app/process/page.tsx

import React from 'react';
import Header from '@/app/(site)/components/homepage/Header';
import CtaBanner from '@/app/(site)/components/homepage/CtaBanner';
import Footer from '@/app/(site)/components/homepage/Footer';
import { PROCESS_STEPS } from '@/data/content';
import { ArrowRight } from 'lucide-react';

export default function ProcessPage() {
  return (
    <>
      <Header />
      <main>
        {/* Hero de la Página */}
        <section className="bg-light py-5">
          <div className="container text-center">
            <h1 className="display-5 fw-bold text-dark">Get Started with OrderCraft in 3 Easy Steps</h1>
            <p className="lead text-muted mx-auto" style={{ maxWidth: '800px' }}>
              From setup to first order, OrderCraft makes it easy in three intuitive steps.
            </p>
          </div>
        </section>

        {/* Sección de Pasos Principales (Reutiliza PROCESS_STEPS) */}
        <section className="py-5">
          <div className="container">
            <div className="row justify-content-center position-relative">
              {PROCESS_STEPS.map((step, index) => (
                <React.Fragment key={step.number}>
                  <div className="col-lg-4 text-center mb-5 mb-lg-0">
                    <div className="d-flex flex-column align-items-center">
                      <div className="bg-primary text-white rounded-circle d-flex align-items-center justify-content-center fw-bold fs-5 shadow-lg mb-3" style={{ width: '4rem', height: '4rem' }}>
                        {step.number}
                      </div>
                      <h3 className="h5 fw-bold text-dark">{step.title}</h3>
                      <p className="text-muted mt-2 px-3">{step.description}</p>
                    </div>
                  </div>
                  {/* Flecha Separadora */}
                  {index < PROCESS_STEPS.length - 1 && (
                    <div className="col-lg-1 d-none d-lg-flex align-items-center justify-content-center">
                      <ArrowRight size={30} className="text-secondary opacity-50" />
                    </div>
                  )}
                </React.Fragment>
              ))}
            </div>
          </div>
        </section>

        {/* Sección Detallada: Demostración de Flujo */}
        <section className="bg-light py-5">
          <div className="container">
            <h2 className="h3 fw-bold text-center text-dark mb-5">Detalle del Flujo de Trabajo</h2>
            <div className="row align-items-center mb-5">
              <div className="col-md-6">
                <h4 className="h5 fw-bold text-primary">Step 1: Set Up Your Restaurant</h4>
                <p className="text-muted">Create your personalized subdomain and enter your administrator information to get started.
                  This sets up your restaurant’s profile securely, giving you full control over your account from day one.</p>
              </div>
              <div className="col-md-6">
                <h4 className="h5 fw-bold text-primary">Step 2: Build & Configure</h4>
                <p className="text-muted">Design and organize your menu, set up delivery options (Full Plan required), and configure your marketing profile.
                  This step ensures your restaurant is fully prepared to handle orders, engage customers, and manage operations efficiently.</p>
              </div>
            </div>
            <div className="row align-items-center mb-5">
              <div className="col-md-6">
                <h4 className="h5 fw-bold text-primary">Step 3: Start Taking Orders & Grow</h4>
                <p className="text-muted">Begin processing orders immediately across dine-in, pickup, and delivery channels.
                Use reports, marketing tools, and smart insights to optimize performance, increase sales, and scale your restaurant with confidence.</p>
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