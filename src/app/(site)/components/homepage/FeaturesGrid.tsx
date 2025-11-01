// components/homepage/FeaturesGrid.tsx

import React from 'react';
import { FEATURES, Feature } from '@/data/content';
// No necesitamos IconCard, integramos el icono directamente

const FeatureCard: React.FC<{ feature: Feature }> = ({ feature }) => {
  const IconComponent = feature.icon;

  return (
    <div className="card border-0 shadow-lg text-center h-100 transition-shadow">
      <div className="card-body p-4">
        {/* Icono */}
        <IconComponent className="h-10 w-10 text-primary mx-auto mb-3" size={40} />
        {/* Título */}
        <h3 className="card-title h5 fw-bold text-dark mb-2">{feature.title}</h3>
        {/* Descripción */}
        <p className="card-text text-muted">{feature.description}</p>
      </div>
    </div>
  );
};

export default function FeaturesGrid() {
  return (
    <section className="py-5 py-md-5" id="features">
      <div className="container">
        <div className="text-center mb-5">
          <h2 className="display-6 fw-bold text-dark mb-3">Power Built for Modern Restaurants</h2>
          <p className="lead text-muted mx-auto" style={{ maxWidth: '700px' }}>
            Everything you need to run smarter — speed, control, and effortless growth in one platform.
          </p>
        </div>
        
        <div className="row g-4">
          {FEATURES.map((feature, index) => (
            <div key={index} className="col-lg-3 col-md-6">
              <FeatureCard feature={feature} />
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}