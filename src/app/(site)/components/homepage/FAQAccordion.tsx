// components/homepage/FAQAccordion.tsx

import React from 'react';
import Accordion from './Accordion';
import { FAQ_ITEMS } from '@/data/content';

export default function FAQAccordion() {
  return (
    <section className="py-5 py-md-5" id="faq">
      <div className="container">
        <div className="text-center mb-5">
          <h2 className="display-6 fw-bold text-dark mb-3">Frequently Asked Questions</h2>
          <p className="lead text-muted mx-auto" style={{ maxWidth: '700px' }}>
            Find quick answers to the most common questions about our services.
          </p>
        </div>

        {/* Contenedor del Acordeón de Bootstrap */}
        <div className="row justify-content-center">
          <div className="col-lg-8">
            <div className="accordion" id="faqAccordion">
              {FAQ_ITEMS.map((item, index) => (
                <Accordion 
                  key={index} 
                  question={item.question} 
                  answer={item.answer} 
                  id={`q${index}`} // ID único
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}