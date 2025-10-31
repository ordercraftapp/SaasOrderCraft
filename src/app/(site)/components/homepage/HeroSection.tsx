// components/homepage/HeroSection.tsx

import React from 'react';

export default function HeroSection() {
  return (
    // Se aplica la nueva clase CSS personalizada y se eliminan las clases bg-light/py-5 anteriores
    <section 
      className="hero-background-image d-flex align-items-center" 
      id="hero"
    >
      <div className="container text-center text-white py-5" style={{ zIndex: 2 }}>
        
        {/* Títulos y Subtítulos cambiados a 'text-white' o 'text-warning' para contraste */}
        <h1 className="display-4 fw-bolder mb-3">
          Control Total, <br className="d-none d-md-inline" />
          <span className="text-warning">Crecimiento Asegurado.</span>
        </h1>
        <p className="lead text-light mb-5 mx-auto" style={{ maxWidth: '700px' }}>
          La solución SaaS más eficiente para el manejo de órdenes, cocina y servicio en tu restaurante.
        </p>

        {/* Domain Search Input Field (El texto dentro debe ser claro) */}
        <div className="row justify-content-center mb-3">
          <div className="col-lg-8 col-xl-6">
            <div className="input-group input-group-lg shadow-lg rounded-pill">
              <input
                type="text"
                placeholder="Ingresa tu email para un demo gratuito..."
                className="form-control border-0 rounded-start-pill py-3 px-4"
              />
              <button className="btn btn-primary rounded-end-pill px-4 d-flex align-items-center">
                Solicitar Demo
              </button>
            </div>
          </div>
        </div>

        <p className="mt-3 text-sm text-light">
          Empieza hoy mismo. Sin tarjeta de crédito.
        </p>
      </div>
    </section>
  );
}