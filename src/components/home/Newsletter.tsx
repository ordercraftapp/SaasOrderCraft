'use client';

import React, { useState } from 'react';

type NewsletterCfg = {
  title?: string;
  text?: string;
  placeholderEmail?: string;
  buttonLabel?: string;
  successMsg?: string;
  errorMsg?: string;
  // imageUrl?: string;
};

export default function Newsletter(props: { cfg?: NewsletterCfg }) {
  const c = props.cfg || {};
  const [email, setEmail] = useState('');
  const [hp, setHp] = useState(''); // honeypot
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setMsg(null); setErr(null);

    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!emailOk) { setErr('Please enter a valid email'); return; }
    if (hp.trim() !== '') { setMsg(c.successMsg || 'Thanks!'); setEmail(''); return; } // bot

    setLoading(true);
    try {
      const res = await fetch('/api/newsletter/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      if (res.ok) {
        setMsg(c.successMsg || 'Thanks! Check your inbox.');
        setEmail('');
      } else {
        setErr(c.errorMsg || 'Sorry, something went wrong. Try again.');
      }
    } catch {
      setErr(c.errorMsg || 'Sorry, something went wrong. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section id="newsletter" className="py-5 position-relative" style={{
      background: 'radial-gradient(1200px 400px at 50% -50%, rgba(255,255,255,0.3), transparent 60%)'
    }}>
      <div className="container">
        <div className="mx-auto" style={{ maxWidth: 720 }}>
          <div className="card shadow-lg border-0 rounded-4" style={{ backdropFilter: 'blur(6px)', background: 'rgba(255,255,255,0.7)' }}>
            <div className="card-body p-4 p-lg-5">
              <h2 className="display-6 mb-2">{c.title || 'Join our newsletter'}</h2>
              <p className="lead text-muted mb-4">{c.text || 'News, promos & seasonal dishes — no spam.'}</p>

              <form onSubmit={onSubmit} className="d-flex gap-2 flex-column flex-lg-row" aria-live="polite">
                {/* honeypot */}
                <input
                  type="text"
                  value={hp}
                  onChange={(e) => setHp(e.target.value)}
                  tabIndex={-1}
                  autoComplete="off"
                  style={{ position: 'absolute', left: '-9999px', opacity: 0, height: 0, width: 0 }}
                  aria-hidden="true"
                />
                <label className="visually-hidden" htmlFor="nl-email">Email</label>
                <input
                  id="nl-email"
                  type="email"
                  className="form-control form-control-lg"
                  placeholder={c.placeholderEmail || 'Your email'}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
                <button className="btn btn-dark btn-lg" disabled={loading}>
                  {loading ? 'Subscribing…' : (c.buttonLabel || 'Subscribe')}
                </button>
              </form>

              {(msg || err) && (
                <div className={`mt-3 ${err ? 'text-danger' : 'text-success'}`}>
                  {msg || err}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
