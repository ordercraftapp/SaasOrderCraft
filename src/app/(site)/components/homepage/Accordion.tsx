// components/homepage/Accordion.tsx (Reusable UI Component for Bootstrap)

'use client';

import React, { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

interface AccordionProps {
  question: string;
  answer: string;
  id: string; // Necesario para el colapso de Bootstrap
}

export default function Accordion({ question, answer, id }: AccordionProps) {
  const [isOpen, setIsOpen] = useState(false);
  const targetId = `collapse-${id}`;

  return (
    <div className="accordion-item">
      <h2 className="accordion-header" id={`heading-${id}`}>
        <button
          className={`accordion-button ${isOpen ? '' : 'collapsed'} fw-bold`}
          type="button"
          data-bs-toggle="collapse"
          data-bs-target={`#${targetId}`}
          aria-expanded={isOpen}
          aria-controls={targetId}
          onClick={() => setIsOpen(!isOpen)}
        >
          {question}
        </button>
      </h2>
      <div
        id={targetId}
        className={`accordion-collapse collapse ${isOpen ? 'show' : ''}`}
        aria-labelledby={`heading-${id}`}
        data-bs-parent="#faqAccordion" // ID del contenedor principal
      >
        <div className="accordion-body text-muted">
          {answer}
        </div>
      </div>
    </div>
  );
}