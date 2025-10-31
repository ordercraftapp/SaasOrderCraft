// app/testimonials/page.tsx

import React from 'react';
import Header from '@/app/(site)/components/homepage/Header';
import CtaBanner from '@/app/(site)/components/homepage/CtaBanner';
import Footer from '@/app/(site)/components/homepage/Footer';
import { TESTIMONIALS, Testimonial } from '@/data/content';
import { Quote, Star } from 'lucide-react';

const FullTestimonialCard: React.FC<{ testimonial: Testimonial }> = ({ testimonial }) => (
  <div className="col-lg-4 col-md-6 mb-4">
    <div className="card shadow-lg border-0 h-100">
      <div className="card-body p-5">
        <div className="d-flex mb-3">
          {[...Array(5)].map((_, i) => (
            <Star key={i} className="text-warning" size={20} fill="currentColor" />
          ))}
        </div>
        <Quote className="text-primary mb-3" size={30} />
        <p className="lead fst-italic text-dark mb-4">"{testimonial.quote}"</p>
        <div className="pt-3 border-top">
          <p className="fw-bold text-dark mb-0">{testimonial.name}</p>
          <p className="text-primary small">{testimonial.title}</p>
        </div>
      </div>
    </div>
  </div>
);

export default function TestimonialsPage() {
  // Duplicamos los testimonios solo para llenar la página
  const allTestimonials = [...TESTIMONIALS, ...TESTIMONIALS]; 

  return (
    <>
      <Header />
      <main>
        {/* Hero de la Página */}
        <section className="bg-light py-5">
          <div className="container text-center">
            <h1 className="display-5 fw-bold text-dark">La Voz de Nuestros Clientes</h1>
            <p className="lead text-muted mx-auto" style={{ maxWidth: '800px' }}>
              Dueños de restaurantes y gerentes que confían en OrderCraft para su operación diaria.
            </p>
          </div>
        </section>

        {/* Grid de Testimonios Extendidos */}
        <section className="py-5">
          <div className="container">
            <div className="row justify-content-center">
              {allTestimonials.map((testimonial, index) => (
                <FullTestimonialCard key={index} testimonial={testimonial} />
              ))}
            </div>
          </div>
        </section>

        {/* Sección Adicional: Cifras de Éxito */}
        <section className="bg-primary text-white py-5">
            <div className="container text-center">
                <h2 className="h3 fw-bold mb-4">El Impacto de OrderCraft en Cifras</h2>
                <div className="row">
                    <div className="col-md-4">
                        <p className="display-4 fw-bold mb-0">95%</p>
                        <p className="lead">Reducción de Errores de Pedido</p>
                    </div>
                    <div className="col-md-4">
                        <p className="display-4 fw-bold mb-0">20%</p>
                        <p className="lead">Aumento en la Capacidad de Mesas</p>
                    </div>
                    <div className="col-md-4">
                        <p className="display-4 fw-bold mb-0">7 min</p>
                        <p className="lead">Ahorro Promedio por Pedido</p>
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