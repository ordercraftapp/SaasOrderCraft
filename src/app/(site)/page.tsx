// app/page.tsx

import Header from '@/app/(site)/components/homepage/Header';
import HeroSection from '@/app/(site)/components/homepage/HeroSection';
import FeaturesGrid from '@/app/(site)/components/homepage/FeaturesGrid';
import ProcessSteps from '@/app/(site)/components/homepage/ProcessSteps';
import PricingTable from '@/app/(site)/components/homepage/PricingTable';
import Testimonials from '@/app/(site)/components/homepage/Testimonials';
import FAQAccordion from '@/app/(site)/components/homepage/FAQAccordion';
import CtaBanner from '@/app/(site)/components/homepage/CtaBanner';
import Footer from '@/app/(site)/components/homepage/Footer';


export default function HomePage() {
  return (
    <>
      
      <Header />      
      <main>        
        <HeroSection />        
        <FeaturesGrid />        
        <ProcessSteps />        
        <PricingTable />        
        <Testimonials />        
        <FAQAccordion />        
        <CtaBanner />
      </main>      
      <Footer />
    </>
  );
}

