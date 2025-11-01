// app/features/page.tsx

import React from 'react';
import Header from '@/app/(site)/components/homepage/Header';
import CtaBanner from '@/app/(site)/components/homepage/CtaBanner';
import Footer from '@/app/(site)/components/homepage/Footer';
import { FEATURES, Feature } from '@/data/content';
import { CheckCircle } from 'lucide-react';

// Componente para una tarjeta de característica detallada
const DetailedFeatureCard: React.FC<{ feature: Feature }> = ({ feature }) => {
  const IconComponent = feature.icon;
  return (
    <div className="col-lg-6 mb-4">
      <div className="d-flex align-items-start p-4 bg-white rounded shadow-sm h-100">
        <IconComponent className="text-primary me-3 flex-shrink-0" size={36} />
        <div>
          <h3 className="h5 fw-bold text-dark mb-2">{feature.title}</h3>
          <p className="text-muted">{feature.description}</p>
        </div>
      </div>
    </div>
  );
};

// Componente de una Sub-Sección de Detalle
const FeatureDetailSection: React.FC<{ title: string; subtitle: string; features: string[] }> = ({ title, subtitle, features }) => (
  <div className="py-5">
    <h3 className="h4 fw-bold text-dark mb-3">{title}</h3>
    <p className="lead text-muted mb-4">{subtitle}</p>
    <ul className="list-unstyled row">
      {features.map((item, index) => (
        <li key={index} className="col-md-6 mb-2 d-flex align-items-start">
          <CheckCircle className="text-success me-2 flex-shrink-0" size={20} />
          <span className="text-dark">{item}</span>
        </li>
      ))}
    </ul>
  </div>
);

export default function FeaturesPage() {
  return (
    <>
      <Header />
      <main>
        {/* Hero de la Página */}
        <section className="bg-light py-5">
          <div className="container text-center">
            <h1 className="display-5 fw-bold text-dark">Power Your Restaurant with OrderCraft</h1>
            <p className="lead text-muted mx-auto" style={{ maxWidth: '800px' }}>
              Discover management tools designed to optimize every part of your operation, from the kitchen to your customers.
            </p>
          </div>
        </section>

        {/* Sección de Características Principales (Reutiliza FEATURES) */}
        <section className="py-5">
          <div className="container">
            <h2 className="text-center h3 fw-bold text-primary mb-4">Our Key Solutions</h2>
            <div className="row">
              {FEATURES.map((feature, index) => (
                <DetailedFeatureCard key={index} feature={feature} />
              ))}
            </div>
          </div>
        </section>

        {/* Sección Detallada 1: Gestión de Órdenes */}
        <section className="bg-light py-5">
          <div className="container">
            <FeatureDetailSection
              title="Streamlined Kitchen Workflow"
              subtitle="Centralize all orders — dine-in, delivery, or pickup — on a single KDS screen, reducing confusion and speeding up preparation."
              features={[
                "Manage dine-in, pickup, and delivery all in one place.",
                "Real-time updates for kitchen staff",
                "Tiempos de espera estimados basados en la carga actual.",
                "Order tracking from the Customer Portal",
              ]}
            />
          </div>
        </section>

        {/* Sección Detallada 2: Analítica y Reportes */}
        <section className="py-5">
          <div className="container">
            <FeatureDetailSection
              title="Smart Reports for Key Decisions"
              subtitle="Get clear metrics on dish performance, hourly sales, and staff productivity."
              features={[
                "Daily, weekly, and monthly reports.",
                "Item performance analysis (menu engineering).",
                "Full visibility on the source of every order.",
                "Export reports easily to Excel for deeper analysis and record keeping.",
              ]}
            />
          </div>
        </section>

        <CtaBanner />
      </main>
      <Footer />
    </>
  );
}