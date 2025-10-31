// components/homepage/Header.tsx

'use client';

import React from 'react';
import Link from 'next/link';
// Usaremos la clase de Bootstrap 'navbar-toggler-icon' en lugar de un icono de Lucide
import { NAV_LINKS } from '@/data/content';

export default function Header() {
  return (
    <header>
      <nav className="navbar navbar-expand-lg navbar-light bg-white shadow-sm sticky-top">
        <div className="container">
          {/* Logo */}
          <Link href="/" className="navbar-brand text-primary fw-bold fs-4">
            RaptorHost
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