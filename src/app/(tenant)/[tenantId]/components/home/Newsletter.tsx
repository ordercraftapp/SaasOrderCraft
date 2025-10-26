'use client';

import React, { useState } from 'react';
import { useTenantId } from '@/lib/tenant/context';
import { tenantPath } from '@/lib/tenant/paths';

type NewsletterCfg = {
  title?: string;
  text?: string;
  placeholderEmail?: string;
  buttonLabel?: string;
  successMsg?: string;
  errorMsg?: string;
};

export default function Newsletter(props: { cfg?: NewsletterCfg }) {
  const c = props.cfg || {};
  const [email, setEmail] = useState('');
  const [hp, setHp] = useState(''); // honeypot
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const tenantId = useTenantId();

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;

    setMsg(null);
    setErr(null);

    const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
    if (!emailOk) {
      setErr(c.errorMsg || 'Please enter a valid email');
      return;
    }

    // Honeypot → éxito silencioso
    if (hp.trim() !== '') {
      setMsg(c.successMsg || 'Thanks!');
      setEmail('');
      return;
    }

    setLoading(true);
    try {
      const apiUrl = tenantId
        ? tenantPath(tenantId, '/app/api/newsletter/subscribe')
        : '/api/newsletter/subscribe';

      const res = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, tenantId }), // enviar tenantId no hace daño (servidor usa el del path)
      });

      if (res.ok) {
        setMsg(c.successMsg || 'Thanks! Check your inbox.');
        setEmail('');
      } else {
        const { error } = await res.json().catch(() => ({ error: 'unknown' }));
        if (error === 'list_not_configured') {
          setErr('Newsletter not ready yet. Please try again later.');
        } else if (error === 'invalid_email') {
          setErr(c.errorMsg || 'Please enter a valid email');
        } else {
          setErr(c.errorMsg || 'Sorry, something went wrong. Try again.');
        }
      }
    } catch {
      setErr(c.errorMsg || 'Sorry, something went wrong. Try again.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section
      id="newsletter"
      className="py-5 position-relative"
      style={{ background: 'radial-gradient(1200px 400px at 50% -50%, rgba(255,255,255,0.3), transparent 60%)' }}
    >
      <div className="container">
        <div className="mx-auto" style={{ maxWidth: 720 }}>
          <div className="card shadow-lg border-0 rounded-4" style={{ backdropFilter: 'blur(6px)', background: 'rgba(255,255,255,0.7)' }}>
            <div className="card-body p-4 p-lg-5">
              <h2 className="display-6 mb-2">{c.title || 'Join our newsletter'}</h2>
              <p className="lead text-muted mb-4">{c.text || 'News, promos & seasonal dishes — no spam.'}</p>

              <form onSubmit={onSubmit} className="d-flex gap-2 flex-column flex-lg-row" aria-live="polite" aria-busy={loading}>
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
                  disabled={loading}
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
