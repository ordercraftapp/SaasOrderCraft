// app/page.tsx
// Este archivo combina todos los componentes de la landing page.

// Importación de todos los componentes de la carpeta 'components/homepage' 
import Header from '@/app/(site)/components/homepage/Header';
import HeroSection from '@/app/(site)/components/homepage/HeroSection';
import FeaturesGrid from '@/app/(site)/components/homepage/FeaturesGrid';
import ProcessSteps from '@/app/(site)/components/homepage/ProcessSteps';
import PricingTable from '@/app/(site)/components/homepage/PricingTable';
import Testimonials from '@/app/(site)/components/homepage/Testimonials';
import FAQAccordion from '@/app/(site)/components/homepage/FAQAccordion';
import CtaBanner from '@/app/(site)/components/homepage/CtaBanner';
import Footer from '@/app/(site)/components/homepage/Footer';

// Define el componente principal de la página
export default function HomePage() {
  return (
    <>
      {/* 1. Encabezado / Navegación */}
      <Header />

      {/* 2. Contenedor principal de la página (main) */}
      <main>
        {/* 2.1. Sección Principal: Impacto y Búsqueda de Dominio */}
        <HeroSection />

        {/* 2.2. Grid de Características Destacadas */}
        <FeaturesGrid />

        {/* 2.3. Proceso o Pasos para Empezar */}
        <ProcessSteps />

        {/* 2.4. Tabla de Precios (con toggle mensual/anual) */}
        <PricingTable />

        {/* 2.5. Testimonios o Pruebas Sociales */}
        <Testimonials />

        {/* 2.6. Preguntas Frecuentes (FAQ) */}
        <FAQAccordion />

        {/* 2.7. Banner Final de Llamada a la Acción */}
        <CtaBanner />
      </main>

      {/* 3. Pie de Página */}
      <Footer />
    </>
  );
}

/**
 * Nota: El uso de 'main' en la página asegura una estructura HTML semántica.
 * El orden es crucial para que la página se vea como la plantilla de Colorlib.
 */