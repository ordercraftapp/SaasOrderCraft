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
            <h1 className="display-5 fw-bold text-dark">Cómo OrderCraft Transforma tu Servicio</h1>
            <p className="lead text-muted mx-auto" style={{ maxWidth: '800px' }}>
              De la mesa al plato en tres sencillos e intuitivos pasos.
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
                <h4 className="h5 fw-bold text-primary">Paso 1: Recepción Centralizada</h4>
                <p className="text-muted">Todos los pedidos (mesas, teléfono, apps de delivery) llegan instantáneamente a la misma interfaz. No más errores al transcribir.</p>
              </div>
              <div className="col-md-6 text-center">
                {/* Placeholder para una imagen o diagrama del flujo de pedido */}
                <div className="bg-white p-4 rounded shadow-sm text-muted"> [Diagrama de Flujo Digital] </div>
              </div>
            </div>
            {/* Repetir estructura para Paso 2 y 3 */}
          </div>
        </section>

        <CtaBanner />
      </main>
      <Footer />
    </>
  );
}