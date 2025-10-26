'use client';

import React from 'react';
import { useTenantId } from '@/lib/tenant/context';
import { tenantPath } from '@/lib/tenant/paths';

// 🔤 i18n
import { t as translate } from '@/lib/i18n/t';
import { useTenantSettings } from '@/lib/settings/hooks';

type NewsletterCfg = {
  title?: string;
  text?: string;
  placeholderEmail?: string;
  buttonLabel?: string;
  successMsg?: string;
  errorMsg?: string;
};

function isValidEmail(e?: string) {
  return !!e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

export default function Newsletter(props: { cfg?: NewsletterCfg }) {
  const cfg = props.cfg || {};
  const tenantId = useTenantId();

  // 1) Leer SOLO de DB. Soporta ambas formas: settings.language o settings.general.language
  const { settings } = useTenantSettings();
  const rawLang =
    (settings as any)?.language ??
    (settings as any)?.general?.language ??
    undefined; // si es undefined, t() cae a "es" por tu getLang

  // helper: pasa el idioma crudo en cada render (sin memo) — así reacciona inmediato
  const tt = React.useCallback(
    (key: string, fallback: string, vars?: Record<string, unknown>) => {
      const s = translate(rawLang, key, vars);
      return s === key ? fallback : s;
    },
    [rawLang]
  );

  const [email, setEmail] = React.useState('');
  const [hp, setHp] = React.useState(''); // honeypot
  const [loading, setLoading] = React.useState(false);
  const [msg, setMsg] = React.useState<string | null>(null);
  const [err, setErr] = React.useState<string | null>(null);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (loading) return;

    setMsg(null);
    setErr(null);

    if (!isValidEmail(email)) {
      setErr(tt('newsletter.errors.invalidEmail', 'Please enter a valid email'));
      return;
    }

    // Honeypot ⇒ éxito silencioso
    if (hp.trim() !== '') {
      setMsg(cfg.successMsg ?? tt('newsletter.success', 'Thanks! Check your inbox.'));
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
        body: JSON.stringify({ email, tenantId }), // el server usa el del path
      });

      if (res.ok) {
        setMsg(cfg.successMsg ?? tt('newsletter.success', 'Thanks! Check your inbox.'));
        setEmail('');
      } else {
        let code: string | undefined;
        try {
          const data = await res.json();
          code = data?.error;
        } catch {}
        if (code === 'invalid_email') {
          setErr(tt('newsletter.errors.invalidEmail', cfg.errorMsg ?? 'Please enter a valid email'));
        } else if (code === 'list_not_configured') {
          setErr(tt('newsletter.errors.listNotConfigured', cfg.errorMsg ?? 'Newsletter is not ready yet.'));
        } else {
          setErr(cfg.errorMsg ?? tt('newsletter.errors.generic', 'Sorry, something went wrong. Try again.'));
        }
      }
    } catch {
      setErr(cfg.errorMsg ?? tt('newsletter.errors.generic', 'Sorry, something went wrong. Try again.'));
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
          <div
            className="card shadow-lg border-0 rounded-4"
            style={{ backdropFilter: 'blur(6px)', background: 'rgba(255,255,255,0.7)' }}
          >
            <div className="card-body p-4 p-lg-5">
              <h2 className="display-6 mb-2">
                {cfg.title ?? tt('newsletter.title', 'Join our newsletter')}
              </h2>
              <p className="lead text-muted mb-4">
                {cfg.text ?? tt('newsletter.text', 'News, promos & seasonal dishes — no spam.')}
              </p>

              <form
                onSubmit={onSubmit}
                className="d-flex gap-2 flex-column flex-lg-row"
                aria-live="polite"
                aria-busy={loading}
              >
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
                  placeholder={cfg.placeholderEmail ?? tt('newsletter.placeholderEmail', 'Your email')}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  disabled={loading}
                />
                <button className="btn btn-dark btn-lg" disabled={loading}>
                  {loading
                    ? tt('newsletter.loading', 'Subscribing…')
                    : (cfg.buttonLabel ?? tt('newsletter.button', 'Subscribe'))}
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
