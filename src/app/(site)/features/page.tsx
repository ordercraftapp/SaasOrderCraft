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
            <h1 className="display-5 fw-bold text-dark">Potencia tu Restaurante con OrderCraft</h1>
            <p className="lead text-muted mx-auto" style={{ maxWidth: '800px' }}>
              Descubre las herramientas de gestión diseñadas para optimizar cada aspecto de tu operación, desde la cocina hasta el cliente.
            </p>
          </div>
        </section>

        {/* Sección de Características Principales (Reutiliza FEATURES) */}
        <section className="py-5">
          <div className="container">
            <h2 className="text-center h3 fw-bold text-primary mb-4">Nuestras Soluciones Clave</h2>
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
              title="Flujo de Órdenes Sin Errores"
              subtitle="Centraliza todos los pedidos (mesa, delivery, pick-up) en una única pantalla KDS, eliminando confusiones y acelerando la preparación."
              features={[
                "Soporte para múltiples canales de venta.",
                "Actualizaciones en tiempo real para el personal de cocina.",
                "Tiempos de espera estimados basados en la carga actual.",
                "Sistema de alertas para pedidos con retraso.",
              ]}
            />
          </div>
        </section>

        {/* Sección Detallada 2: Analítica y Reportes */}
        <section className="py-5">
          <div className="container">
            <FeatureDetailSection
              title="Informes Inteligentes para Decisiones Clave"
              subtitle="Obtén métricas claras sobre rendimiento de platos, ventas por hora y productividad del personal."
              features={[
                "Reportes diarios, semanales y mensuales.",
                "Análisis de rendimiento de ítems (menú engineering).",
                "Control de inventario integrado.",
                "Acceso seguro a datos desde cualquier dispositivo.",
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