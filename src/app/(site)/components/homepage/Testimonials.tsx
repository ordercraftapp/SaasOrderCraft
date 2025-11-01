// components/homepage/Testimonials.tsx

import React from 'react';
import { TESTIMONIALS, Testimonial } from '@/data/content';
import { Quote } from 'lucide-react';

const TestimonialCard: React.FC<{ testimonial: Testimonial }> = ({ testimonial }) => (
  <div className="col-md-6 mb-4">
    <div className="card shadow-sm border-0 h-100">
      <div className="card-body p-4">
        <Quote className="text-primary mb-3" size={30} />
        <p className="lead fst-italic text-dark mb-4">{testimonial.quote}</p>
        <div className="pt-3 border-top">
          <p className="fw-bold text-dark mb-0">{testimonial.name}</p>
          <p className="text-primary small">{testimonial.title}</p>
        </div>
      </div>
    </div>
  </div>
);

export default function Testimonials() {
  return (
    <section className="py-5 py-md-5 bg-light" id="testimonials">
      <div className="container">
        <div className="text-center mb-5">
          <h2 className="display-6 fw-bold text-dark mb-3">What Restaurant Owners Are Saying</h2>
          <p className="lead text-muted mx-auto" style={{ maxWidth: '700px' }}>
            See how OrderCraft is helping restaurants streamline operations and grow every day.
          </p>
        </div>
        
        <div className="row justify-content-center">
          {TESTIMONIALS.map((testimonial, index) => (
            <TestimonialCard key={index} testimonial={testimonial} />
          ))}
        </div>
      </div>
    </section>
  );
}