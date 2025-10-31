// components/homepage/HeroSection.tsx

import React from 'react';

export default function HeroSection() {
  return (
    <section className="bg-light py-5 py-md-5" id="hero">
      <div className="container text-center py-5">
        <h1 className="display-4 fw-bolder text-dark mb-3">
          Blazing Fast Hosting. <br className="d-none d-md-inline" />
          <span className="text-primary">Unbeatable Support.</span>
        </h1>
        <p className="lead text-muted mb-5 mx-auto" style={{ maxWidth: '700px' }}>
          Secure, reliable web hosting built for speed and engineered for success. Find your perfect domain today.
        </p>

        {/* Domain Search Input Field */}
        <div className="row justify-content-center mb-3">
          <div className="col-lg-8 col-xl-6">
            <div className="input-group input-group-lg shadow-lg rounded-pill">
              <input
                type="text"
                placeholder="Search for your perfect domain name..."
                className="form-control border-0 rounded-start-pill py-3 px-4"
              />
              <button className="btn btn-primary rounded-end-pill px-4 d-flex align-items-center">
                <i className="bi bi-search me-2 d-none d-sm-block"></i> Search
              </button>
            </div>
          </div>
        </div>

        <p className="mt-3 text-sm text-secondary">
          .com, .net, .org, .co, and more available starting at **$9.99/yr**.
        </p>
      </div>
    </section>
  );
}