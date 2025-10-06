'use client';

import React from 'react';

type Branch = {
  branchId: string;
  branchName?: string;
  address?: string;

  /** New single-value fields */
  phone?: string;
  email?: string;
  webpage?: string;

  /** Legacy arrays (still tolerated for backward-compat) */
  phones?: string[];
  emails?: string[];
  // schedule?: string;
};

type ContactCfg = {
  title?: string;
  text?: string;
  branches?: Branch[];
};

/** Normalize helpers: keep compat with old arrays */
function pickPhone(b: Branch): string | undefined {
  if (b.phone && b.phone.trim()) return b.phone.trim();
  const fromArr = (b.phones || []).find(Boolean);
  return fromArr?.trim();
}
function pickEmail(b: Branch): string | undefined {
  if (b.email && b.email.trim()) return b.email.trim();
  const fromArr = (b.emails || []).find(Boolean);
  return fromArr?.trim();
}
function normTelHref(raw?: string): string | undefined {
  if (!raw) return undefined;
  // remove spaces, parentheses, and dashes for tel link
  const tel = raw.replace(/[\s()-]/g, '');
  return tel ? `tel:${tel}` : undefined;
}
function normWebHref(raw?: string): string | undefined {
  if (!raw) return undefined;
  const val = raw.trim();
  if (!val) return undefined;
  // add https if missing protocol
  if (!/^https?:\/\//i.test(val)) return `https://${val}`;
  return val;
}

export default function ContactList(props: { cfg?: ContactCfg }) {
  const c = props.cfg || { branches: [] };
  const branches = c.branches || [];

  return (
    <section
      id="contact"
      className="position-relative py-5 py-md-6 overflow-hidden"
      aria-labelledby="contact-heading"
      style={{
        background:
          // mismo espíritu que AboutUs: dos radiales suaves en esquinas opuestas
          'radial-gradient(1200px 600px at -10% -20%, rgba(255,220,180,.35), transparent 60%), radial-gradient(900px 500px at 110% 20%, rgba(180,220,255,.35), transparent 60%)',
      }}
    >
      <div className="container position-relative">
        <div className="mx-auto" style={{ maxWidth: 980 }}>
          <div className="text-center mb-4">
            <span className="badge bg-dark-subtle text-dark mb-2">Contact</span>
            <h2 id="contact-heading" className="display-6 fw-bold mb-2">
              {c.title || 'Contact us'}
            </h2>
            <p className="lead text-muted">
              {c.text || 'Find us or reach out by phone/email.'}
            </p>
          </div>

          {branches.length === 0 && (
            <div className="text-muted text-center">No branches configured.</div>
          )}

          <div className="row g-4 g-lg-5">
            {branches.map((b) => {
              const phone = pickPhone(b);
              const email = pickEmail(b);
              const web = b.webpage?.trim();
              const telHref = normTelHref(phone);
              const mailHref = email ? `mailto:${email}` : undefined;
              const webHref = normWebHref(web);

              return (
                <div className="col-12 col-md-6 col-lg-4" key={b.branchId}>
                  <div
                    className="card h-100 rounded-4 shadow-sm border-3"
                    style={{
                      background: 'rgba(255,255,255,0.85)',
                      backdropFilter: 'blur(8px) saturate(120%)',
                      WebkitBackdropFilter: 'blur(8px) saturate(120%)',
                      border: '1px solid rgba(0,0,0,0.06)',
                    }}
                  >
                    <div className="card-body p-4">
                      <h5 className="mb-2">{b.branchName || 'Branch'}</h5>

                      {b.address && (
                        <p className="text-muted mb-3">📍 {b.address}</p>
                      )}

                      {phone && (
                        <div className="mb-2">
                          <div className="fw-semibold mb-1">📞 Phone</div>
                          {telHref ? (
                            <a href={telHref} className="link-offset-1">
                              {phone}
                            </a>
                          ) : (
                            <span className="text-muted">{phone}</span>
                          )}
                        </div>
                      )}

                      {email && (
                        <div className="mb-2">
                          <div className="fw-semibold mb-1">✉️ Email</div>
                          {mailHref ? (
                            <a href={mailHref} className="link-offset-1">
                              {email}
                            </a>
                          ) : (
                            <span className="text-muted">{email}</span>
                          )}
                        </div>
                      )}

                      {web && (
                        <div className="mb-0">
                          <div className="fw-semibold mb-1">🌐 Website</div>
                          {webHref ? (
                            <a
                              href={webHref}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="link-offset-1"
                            >
                              {web}
                            </a>
                          ) : (
                            <span className="text-muted">{web}</span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* franja diagonal decorativa  */}
      <div
        className="position-absolute start-0 end-0"
        style={{
          bottom: -30,
          height: 60,
          transform: 'skewY(-2deg)',
          background:
            'linear-gradient(90deg, rgba(255,255,255,.0), rgba(0,0,0,.05), rgba(255,255,255,.0))',
        }}
        aria-hidden="true"
      />

      {/* estilos mínimos para enlaces sobre fondo suave */}
      <style jsx>{`
        :global(.link-offset-1) {
          text-decoration: none;
          position: relative;
        }
        :global(.link-offset-1)::after {
          content: '';
          position: absolute;
          left: 0;
          bottom: -2px;
          width: 100%;
          height: 2px;
          background: currentColor;
          opacity: 0.2;
          transform: scaleX(0.5);
          transform-origin: left;
          transition: transform 160ms ease, opacity 160ms ease;
        }
        :global(.link-offset-1:hover)::after {
          opacity: 0.35;
          transform: scaleX(1);
        }
      `}</style>
    </section>
  );
}
