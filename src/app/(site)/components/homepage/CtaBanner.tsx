// components/homepage/CtaBanner.tsx

import React from 'react';
import Link from 'next/link';

export default function CtaBanner() {
  return (
    <section className="bg-primary text-white py-5 py-md-5">
      <div className="container text-center">
        <h2 className="display-6 fw-bold mb-3">
          Ready to Launch Your Project?
        </h2>
        <p className="lead text-light mb-4 mx-auto" style={{ maxWidth: '700px' }}>
          Join thousands of satisfied customers and experience the difference of premium hosting.
        </p>
        <Link
          href="/signup"
          className="btn btn-light btn-lg rounded-pill px-5 fw-bold shadow-lg"
        >
          Get Started Now
        </Link>
      </div>
    </section>
  );
}