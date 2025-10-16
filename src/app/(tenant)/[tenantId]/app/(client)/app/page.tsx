// src/app/(tenant)/[tenant]/app/(client)/app/page.tsx
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import '@/lib/firebase/client';
import { getFirestore, getDocs, query, where } from 'firebase/firestore';
import { t, getLang } from '@/lib/i18n/t';
import { useTenantSettings } from '@/lib/settings/hooks';
import { useParams } from 'next/navigation';

// ✅ Firestore Web SDK (tenant-aware)
import { tCol } from '@/lib/db'; // tCol('<subcol>', tenantId)

type PromoDoc = {
  id: string;
  name?: string;
  title?: string;
  code?: string;
  active?: boolean;
  startAt?: any;
  endAt?: any;
  secret?: boolean; // lo usamos solo para esconder del client list
};

function toDateMaybe(x: any): Date | null {
  if (!x) return null;
  if (typeof x?.toDate === 'function') {
    try { return x.toDate(); } catch { /* ignorar */ }
  }
  const d = new Date(x);
  return isNaN(d.getTime()) ? null : d;
}

function normalizeList<T = any>(x: unknown): T[] {
  if (Array.isArray(x)) return x as T[];
  if (x && typeof x === 'object') return Object.values(x as Record<string, T>);
  return [];
}

function uniqById(list: PromoDoc[]): PromoDoc[] {
  const seen = new Set<string>();
  const out: PromoDoc[] = [];
  for (const p of list) {
    const k = String(p.id || p.code || '');
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(p);
  }
  return out;
}

/** Lee tenantId soportando [tenant] y [tenantId] (y como fallback, primer segmento del path). */
function useSafeTenantId() {
  const p = useParams() as Record<string, string | string[] | undefined>;
  let v =
    (typeof p?.tenantId === 'string' ? p.tenantId : Array.isArray(p?.tenantId) ? p.tenantId[0] : undefined) ||
    (typeof p?.tenant === 'string' ? p.tenant : Array.isArray(p?.tenant) ? p.tenant[0] : undefined) ||
    '';

  v = (v || '').trim();
  if (!v && typeof window !== 'undefined') {
    const first = (window.location.pathname || '/').split('/').filter(Boolean)[0] || '';
    v = first.trim();
  }
  return v;
}

export default function AppHome() {
  const { settings } = useTenantSettings();
  const rawLang =
    (settings as any)?.language ??
    (typeof window !== "undefined" ? localStorage.getItem("tenant.language") || undefined : undefined);
  const lang = getLang(rawLang);

  // 👇 tenant y bases de ruta (tenantId seguro)
  const tenantId = useSafeTenantId();
  const appBase = tenantId ? `/${tenantId}/app/` : '/app/';
  const apiBase = appBase; // tus APIs viven bajo /{tenantId}/app/api/...

  const [promos, setPromos] = useState<PromoDoc[]>([]);
  const [loadingPromos, setLoadingPromos] = useState<boolean>(true);
  const [noTenantMsg, setNoTenantMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;

    async function load() {
      try {
        let acc: PromoDoc[] = [];
        const now = new Date();
        const secretIdSet = new Set<string>();
        const secretCodeSet = new Set<string>();
        try {
          const db = getFirestore();
          // ✅ Firestore client: tenants/{tenantId}/promotions
          const qRef = query(tCol('promotions', tenantId), where('active', '==', true));
          const snap = await getDocs(qRef);

          const visibleFromFs: PromoDoc[] = [];
          for (const d of snap.docs) {
            const data = d.data() as any;
            const id = d.id;
            const code = data?.code ? String(data.code) : undefined;
            const isSecret = data?.secret === true;

            // Sigue secretos para filtrar los resultados del API después también
            if (isSecret) {
              secretIdSet.add(id);
              if (code) secretCodeSet.add(code);
            }

            // solo push promociones visibles que tienen secret false
            const start = toDateMaybe(data?.startAt);
            const end = toDateMaybe(data?.endAt);
            const inWindow = (!start || now >= start) && (!end || now <= end);
            const active = data?.active !== false;

            if (active && inWindow && code && !isSecret) {
              visibleFromFs.push({
                id,
                name: data?.name,
                title: data?.title,
                code,
                active: true,
                startAt: data?.startAt,
                endAt: data?.endAt,
                secret: false,
              });
            }
          }

          acc = acc.concat(visibleFromFs);
        } catch { /* silencio */ }

        // 2) endpoint público (tenant-aware) — se filtra por secreto
        try {
          const res = await fetch(`${apiBase}/api/promotions/public`, { cache: 'no-store' });
          if (res.ok) {
            const j = await res.json().catch(() => ({}));
            const arr = normalizeList<any>(j?.items ?? j?.promotions ?? []);
            const now2 = new Date();
            const filtered = arr
              .filter((p) => {
                const active = p?.active !== false;
                const start = toDateMaybe(p?.startAt);
                const end = toDateMaybe(p?.endAt);
                const inWindow = (!start || now2 >= start) && (!end || now2 <= end);
                const code = p?.code ? String(p.code) : undefined;

                // Si el API expone el secreto, se honra; sino se asegura con Firestore secret sets
                const apiSaysSecret = p?.secret === true;
                const idLike = p?.id || p?.promoId || code; // El API puede o no puede proveer el ID de Firestore
                const knownSecret = (idLike && secretIdSet.has(String(idLike))) || (code && secretCodeSet.has(code));

                const isSecret = apiSaysSecret || knownSecret;

                return active && inWindow && code && !isSecret;
              })
              .map((p) => ({
                id: p.id || p.promoId || p.code,
                name: p.name,
                title: p.title,
                code: p.code,
                secret: p?.secret === true,
              })) as PromoDoc[];

            acc = acc.concat(filtered);
          }
        } catch { /* silencio */ }

        // 3) Dedupe por ID y termina
        if (alive) {
          const deduped = uniqById(acc);
          setPromos(deduped);
          setLoadingPromos(false);
        }
      } catch {
        if (alive) setLoadingPromos(false);
      }
    }

    if (!tenantId) {
      // 🔸 Evita spinner eterno cuando el param falla
      setNoTenantMsg('Missing tenant context.');
      setLoadingPromos(false);
      return;
    }

    load();
    return () => { alive = false; };
  }, [tenantId, apiBase]);

  const hasPromos = useMemo(() => promos.length > 0, [promos]);

  return (
    <section className="container py-4">
      <div className="row gy-4">
        {/* Hero */}
        <div className="col-12">
          <div className="text-center">
            <h1 className="display-6 fw-semibold mb-2">{t(lang, "home.welcome")}</h1>
            <p className="lead text-body-secondary">
              {t(lang, "home.start")}{" "}
              <a className="link-primary" href={`${appBase}/menu`}>{t(lang, "home.menuLink")}</a>{" "}
              {t(lang, "home.or")}{" "}
              <a className="link-secondary" href={`${appBase}/orders`}>{t(lang, "home.ordersLink")}</a>.
            </p>

            <div className="d-flex flex-wrap justify-content-center gap-2 mt-3">
              <a href={`${appBase}/menu`} className="btn btn-primary btn-lg" aria-label="View menu">
                {t(lang, "home.btnMenu")}
              </a>
              <a href={`${appBase}/orders`} className="btn btn-outline-secondary btn-lg" aria-label="View my orders">
                {t(lang, "home.btnOrders")}
              </a>
            </div>

            {noTenantMsg && (
              <div className="alert alert-warning mt-3 mb-0 small">
                {noTenantMsg}
              </div>
            )}
          </div>
        </div>

        {/* Quick links */}
        <div className="col-12 col-md-6">
          <div className="card shadow-sm h-100">
            <div className="card-body">
              <h2 className="h5 mb-3">{t(lang, "home.quickLinks")}</h2>
              <div className="d-grid gap-2">
                <a className="btn btn-light" href={`${appBase}/cart-new`} aria-label="View cart">🛒 {t(lang, "home.cart")}</a>
                <a className="btn btn-light" href={`${appBase}/checkout`} aria-label="Go to checkout">💳 {t(lang, "home.checkout")}</a>
                <a className="btn btn-light" href={`${appBase}/user-config`} aria-label="Go to settings">⚙️ {t(lang, "home.settings")}</a>
              </div>
            </div>
          </div>
        </div>

        {/* Tracking/help + Promotions */}
        <div className="col-12 col-md-6">
          <div className="card shadow-sm h-100">
            <div className="card-body">
              <h2 className="h5 mb-3">{t(lang, "home.trackingTitle")}</h2>
              <p className="mb-2 text-body-secondary">
                {t(lang, "home.trackingDesc")}
              </p>
              <a className="btn btn-outline-primary" href={`${appBase}/tracking`} aria-label="Ver seguimiento">
                {t(lang, "home.trackingBtn")}
              </a>

              <hr className="my-4" />

              {/* Promotions */}
              <h3 className="h6 text-body-secondary mb-2">{t(lang, "home.promotionsTitle")}</h3>

              <div
                className="rounded-4 p-3 p-md-4 text-white"
                style={{ background: 'linear-gradient(135deg, #6f42c1, #d63384)' }}
              >
                <div className="d-flex align-items-center justify-content-between mb-3">
                  <div>
                    <div className="fs-5 fw-bold">{t(lang, "home.activeCodes")}</div>
                    <div className="small" style={{ opacity: 0.85 }}>
                      {t(lang, "home.redeem")}
                    </div>
                  </div>
                  <div className="display-6" aria-hidden>🎟️</div>
                </div>

                {loadingPromos && <div className="opacity-75">{t(lang, "home.loadingPromos")}</div>}

                {!loadingPromos && hasPromos && (
                  <div className="d-flex flex-wrap gap-2">
                    {promos.map((p, idx) => (
                      <div
                        key={(p.id || p.code || 'promo') + ':' + idx}
                        className="bg-white text-dark rounded-pill px-3 py-2 shadow-sm d-inline-flex align-items-center"
                        style={{ border: '1px solid rgba(0,0,0,.06)' }}
                      >
                        <div className="me-2">
                          <span className="fw-semibold">{p.name || p.title || t(lang, "home.promotion")}</span>
                        </div>
                        <span className="badge bg-dark-subtle text-dark border">{p.code}</span>
                        <button
                          className="btn btn-sm btn-dark ms-2"
                          onClick={() => navigator.clipboard?.writeText(p.code || '')}
                          aria-label={`${t(lang, "home.copyCode")} ${p.code || ''}`}
                          title={t(lang, "home.copy")}
                          type="button"
                        >
                          {t(lang, "home.copy")}
                        </button>
                      </div>
                    ))}
                  </div>
                )}

                {!loadingPromos && !hasPromos && (
                  <div className="opacity-75">{t(lang, "home.noPromos")}</div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
