// app/faq/page.tsx

import React from 'react';
import Header from '@/app/(site)/components/homepage/Header';
import CtaBanner from '@/app/(site)/components/homepage/CtaBanner';
import Footer from '@/app/(site)/components/homepage/Footer';
import Accordion from '@/app/(site)/components/homepage/Accordion'; 
import { FAQ_ITEMS } from '@/data/content';

// FAQs adicionales para llenar la página
const ADDITIONAL_FAQS = [
    {
        question: '¿Qué tipo de hardware se necesita para OrderCraft?',
        answer: 'OrderCraft es compatible con cualquier tablet o monitor moderno (iOS, Android o Windows) que pueda acceder a un navegador web. No requerimos hardware propietario costoso.'
    },
    {
        question: '¿Ofrecen soporte 24/7?',
        answer: 'Sí, ofrecemos soporte técnico por chat y teléfono 24 horas al día, 7 días a la semana, para todos nuestros planes Pro y Empresarial.'
    },
    {
        question: '¿Es OrderCraft compatible con mi POS (Punto de Venta) actual?',
        answer: 'Trabajamos con las principales plataformas POS del mercado y ofrecemos una API abierta para una integración personalizada. Contáctanos para verificar la compatibilidad específica.'
    },
];

export default function FAQPage() {
    const allFaqs = [...FAQ_ITEMS, ...ADDITIONAL_FAQS];
    
    return (
        <>
            <Header />
            <main>
                {/* Hero de la Página */}
                <section className="bg-light py-5">
                    <div className="container text-center">
                        <h1 className="display-5 fw-bold text-dark">Preguntas Frecuentes sobre OrderCraft</h1>
                        <p className="lead text-muted mx-auto" style={{ maxWidth: '800px' }}>
                            Todo lo que necesitas saber sobre la implementación, uso y soporte de nuestro sistema.
                        </p>
                    </div>
                </section>
                
                {/* Sección de Acordeón Principal */}
                <section className="py-5">
                    <div className="container max-w-4xl">
                        <h2 className="h3 fw-bold text-dark mb-4">Configuración e Implementación</h2>
                        <div className="row justify-content-center">
                            <div className="col-lg-10">
                                <div className="accordion" id="faqAccordion">
                                    {allFaqs.map((item, index) => (
                                        <Accordion 
                                            key={index} 
                                            question={item.question} 
                                            answer={item.answer} 
                                            id={`q${index}`} 
                                        />
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </section>
                
                {/* Sección Adicional: Contacto de Soporte */}
                <section className="bg-light py-5 text-center">
                    <div className="container">
                        <h3 className="h4 fw-bold text-dark mb-3">¿Aún tienes dudas?</h3>
                        <p className="text-muted mb-4">
                            Nuestro equipo de expertos está listo para responder tus preguntas y guiarte en la configuración.
                        </p>
                        <a href="mailto:soporte@ordercraft.com" className="btn btn-primary btn-lg rounded-pill">Contactar a Soporte</a>
                    </div>
                </section>

                <CtaBanner />
            </main>
            <Footer />
        </>
    );
}