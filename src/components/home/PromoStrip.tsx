"use client";

import Image from 'next/image';
import { t } from '@/lib/i18n/t';

type Promo = {
  id: string;
  title: string;
  subtitle?: string;
  badge?: 'primary' | 'success' | 'warning' | 'danger' | 'info';
  imageUrl?: string;
  discountPct?: number;
  href?: string;
  menuItemIds?: string[];
  couponIds?: string[];
  /** ← opcional (inyectado desde el server): lista de códigos de cupones */
  couponCodes?: string[];
};

export default function PromoStrip({ promos, lang }: { promos: Promo[]; lang: string }) {
  if (!promos?.length) return null;

  return (
    <div className="row g-3">
      {promos.map((p) => {
        const codes = Array.isArray(p.couponCodes) ? p.couponCodes.filter(Boolean) : [];

        return (
          <div className="col-12 col-md-6" key={p.id}>
            <article className="card h-100 shadow-sm">
              <div className="row g-0 h-100">
                {/* INFO (75%) */}
                <div className="col-12 col-md-9">
                  <div className="card-body d-flex flex-column h-100">
                    

                    <h3 className="h5">{p.title}</h3>
                    {p.subtitle && <p className="text-muted mb-3">{p.subtitle}</p>}

                    {/* Códigos de cupones (chips) */}
                    {codes.length > 0 && (
                      <div className="mb-3">
                        <div className="d-flex flex-wrap gap-2">
                          {codes.map((code) => (
                            <span key={code} className="badge text-bg-light border">
                              {code}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    <div className="mt-auto">
                      <a className="btn btn-outline-primary" href={p.href || '/menu'}>
                        {t(lang, 'home.promos.explore')}
                      </a>
                    </div>
                  </div>
                </div>

                {/* IMAGEN (25%) */}
                {p.imageUrl && (
                  <div className="col-12 col-md-3">
                    <div className="h-100 w-100 position-relative" style={{ minHeight: 140 }}>
                      <Image
                        src={p.imageUrl}
                        alt={p.title}
                        fill
                        sizes="(max-width: 768px) 100vw, (max-width: 1200px) 25vw, 25vw"
                        loading="lazy"
                        style={{ objectFit: 'cover', borderTopRightRadius: '0.375rem', borderBottomRightRadius: '0.375rem' }}
                      />
                    </div>
                  </div>
                )}
              </div>
            </article>
          </div>
        );
      })}
    </div>
  );
}
