// components/homepage/Header.tsx
// DataCraft Coders 2025 www.datadraftcoders.com

'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { NAV_LINKS } from '@/data/content';

export default function Header() {
  return (
    <header>
      <nav className="navbar navbar-expand-lg navbar-light bg-white shadow-sm sticky-top">
        <div className="container">
          
          <Link href="/" className="navbar-brand p-0" aria-label="OrderCraft home">
            <Image
              src="/images/main-logo.png"     
              alt="OrderCraft"
              width={140}                     
              height={40}                     
              priority                        
              quality={90}                    
              className="d-inline-block align-top"
            />
          </Link>

          {/* Botón de Menú Móvil */}
          <button
            className="navbar-toggler"
            type="button"
            data-bs-toggle="collapse"
            data-bs-target="#navbarNav"
            aria-controls="navbarNav"
            aria-expanded="false"
            aria-label="Toggle navigation"
          >
            <span className="navbar-toggler-icon"></span>
          </button>

          {/* Contenido del Menú */}
          <div className="collapse navbar-collapse justify-content-end" id="navbarNav">
            <ul className="navbar-nav me-auto mb-2 mb-lg-0">
              {NAV_LINKS.map((link) => (
                <li key={link.name} className="nav-item">
                  <Link href={link.href} className="nav-link">
                    {link.name}
                  </Link>
                </li>
              ))}
            </ul>

            {/* CTA Button */}
            <Link
              href="/signup"
              className="btn btn-primary rounded-pill px-4"
            >
              Get Started
            </Link>
          </div>
        </div>
      </nav>
    </header>
  );
}
