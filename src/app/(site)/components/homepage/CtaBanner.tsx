// components/homepage/CtaBanner.tsx

import React from 'react';
import Link from 'next/link';

export default function CtaBanner() {
  return (
    <section className="bg-primary text-white py-5 py-md-5">
      <div className="container text-center">
        <h2 className="display-6 fw-bold mb-3">
          Ready to Launch Your Restaurant?
        </h2>
        <p className="lead text-light mb-4 mx-auto" style={{ maxWidth: '700px' }}>
          Discover why top restaurants run smoother with OrderCraft.
        </p>
        <Link
          href="/pricing"
          className="btn btn-light btn-lg rounded-pill px-5 fw-bold shadow-lg"
        >
          Get Started Now
        </Link>
      </div>
    </section>
  );
}