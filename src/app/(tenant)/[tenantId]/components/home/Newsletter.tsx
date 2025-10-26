'use client';

import React from 'react';
import { useTenantId } from '@/lib/tenant/context';
import { tenantPath } from '@/lib/tenant/paths';

// 🔤 i18n (mismo patrón que tu referencia)
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

function normalizeLang(raw?: string | null): string {
  const v = (raw || '').toLowerCase();
  if (!v) return 'en';
  // soporta es-ES, en-US, pt-BR, fr-FR, etc.
  const short = v.slice(0, 2);
  return short;
}

export default function Newsletter(props: { cfg?: NewsletterCfg }) {
  const cfg = props.cfg || {};
  const tenantId = useTenantId();

  // ===== i18n bootstrap (idéntico a tu referencia + reactivo) =====
  const { settings } = useTenantSettings();

  // estado de idioma reactivo
  const [lang, setLang] = React.useState<string>(() =>
    normalizeLang((settings as any)?.language)
  );

  // cuando cambie settings.language, actualiza
  React.useEffect(() => {
    setLang((prev) => {
      const next = normalizeLang((settings as any)?.language);
      return next || prev || 'en';
    });
  }, [settings]);

  // al montar, sobreescribe con localStorage si existe
  React.useEffect(() => {
    try {
      if (typeof window !== 'undefined') {
        const ls = localStorage.getItem('tenant.language');
        if (ls) setLang(normalizeLang(ls));
      }
    } catch {}
  }, []);

  // escucha cambios de idioma en vivo:
  // - storage (otras pestañas)
  // - evento custom (misma pestaña) → dispatchEvent(new CustomEvent('tenant-language-changed', { detail: 'es' }))
  React.useEffect(() => {
    function onStorage(ev: StorageEvent) {
      if (ev.key === 'tenant.language' && ev.newValue) {
        setLang(normalizeLang(ev.newValue));
      }
    }
    function onCustom(ev: Event) {
      try {
        const detail = (ev as CustomEvent).detail;
        if (typeof detail === 'string') setLang(normalizeLang(detail));
      } catch {}
    }

    window.addEventListener('storage', onStorage);
    window.addEventListener('tenant-language-changed', onCustom as EventListener);

    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('tenant-language-changed', onCustom as EventListener);
    };
  }, []);

  const tt = React.useCallback(
    (key: string, fallback: string, vars?: Record<string, unknown>) => {
      const s = translate(lang, key, vars);
      return s === key ? fallback : s;
    },
    [lang]
  );

  // ===== UI state =====
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
