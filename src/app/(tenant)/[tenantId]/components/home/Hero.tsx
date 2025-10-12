"use client";

import Image from 'next/image';
import { t } from '@/lib/i18n/t';
import { useTenantId } from '@/lib/tenant/context';
import { tenantPath } from '@/lib/tenant/paths';

type HeroSlide = {
  imageUrl: string;
  imageAlt?: string;
  headline: string;
  sub?: string;
  cta?: { label: string; href: string };
  overlay?: 'dark' | 'light' | 'none';
};
type HeroVideo = {
  url: string;
  posterUrl?: string;
  autoplay?: boolean;
  loop?: boolean;
  muted?: boolean;
  blurPx?: number;
};
type HeroData = {
  variant: 'image' | 'carousel' | 'video';
  slides?: HeroSlide[];
  video?: HeroVideo;
};

function isYouTube(url: string) { return /youtube\.com|youtu\.be/.test(url); }
function isVimeo(url: string) { return /vimeo\.com/.test(url); }
function isMp4(url: string) { return /\.mp4($|\?)/i.test(url); }
function ytId(u: string) {
  try {
    const url = new URL(u);
    if (url.hostname.includes('youtu.be')) return url.pathname.slice(1);
    if (url.searchParams.get('v')) return url.searchParams.get('v')!;
    const parts = url.pathname.split('/');
    const i = parts.indexOf('embed');
    if (i >= 0 && parts[i + 1]) return parts[i + 1];
  } catch {}
  return null;
}
function buildYtEmbedUrl(id: string, opts: { autoplay?: boolean; muted?: boolean; loop?: boolean }) {
  const ap = opts.autoplay ? 1 : 0;
  const mu = opts.autoplay ? 1 : (opts.muted ? 1 : 0);
  const params = new URLSearchParams({
    rel: '0', modestbranding: '1', controls: '0', playsinline: '1',
    autoplay: String(ap), mute: String(mu),
  });
  return `https://www.youtube-nocookie.com/embed/${id}?${params.toString()}`;
}

// ✅ helpers tenant-aware (sin tocar lógica)
function isAbsoluteUrl(u?: string) {
  return !!u && (/^(https?:)?\/\//i.test(u) || u.startsWith('data:'));
}
function withTenantPrefix(tenantId: string | null, path: string) {
  const norm = path.startsWith('/') ? path : `/${path}`;
  if (!tenantId) return norm; // fallback si aún no hay contexto

  // Evita duplicar prefijo si ya viene como "/{tenantId}/..."
  if (norm === `/${tenantId}` || norm.startsWith(`/${tenantId}/`)) return norm;

  // Construye la URL correcta según wildcard (prod) o path (local)
  return tenantPath(tenantId, norm);
}

export default function Hero({ data, lang }: { data: HeroData; lang: string }) {
  const tenantId = useTenantId();
  const v = data?.variant || 'image';
  const slides = data?.slides || [];

  if (v === 'video' && data?.video?.url) {
    const { url, posterUrl, autoplay = true, loop = true, muted = true, blurPx = 3 } = data.video;

    // ✅ tenant-aware para MP4/poster si son rutas relativas
    const resolvedVideoUrl = isAbsoluteUrl(url) ? url : withTenantPrefix(tenantId, url);
    const resolvedPosterUrl = posterUrl
      ? (isAbsoluteUrl(posterUrl) ? posterUrl : withTenantPrefix(tenantId, posterUrl))
      : undefined;

    const yt = isYouTube(url) ? ytId(url) : null;
    const ytEmbed = yt ? buildYtEmbedUrl(yt, { autoplay, muted, loop }) : null;
    const vimEmbed = isVimeo(url)
      ? url.replace('vimeo.com', 'player.vimeo.com/video').replace('/video/video', '/video')
      : null;

    return (
      <header className="hero-wrap" aria-label={t(lang, 'home.hero.videoAria')}>
        <div className="hero-media">
          {ytEmbed && (
            <iframe
              src={ytEmbed}
              title={t(lang, 'home.hero.videoAria')}
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
              allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
              allowFullScreen
              className="hero-embed"
              style={{ filter: `blur(${blurPx}px)` }}
            />
          )}
          {vimEmbed && !ytEmbed && (
            <iframe
              src={vimEmbed}
              title={t(lang, 'home.hero.videoAria')}
              loading="lazy"
              allow="autoplay; fullscreen; picture-in-picture"
              allowFullScreen
              className="hero-embed"
              style={{ filter: `blur(${blurPx}px)` }}
            />
          )}
          {isMp4(url) && !ytEmbed && !vimEmbed && (
            <video
              className="hero-embed"
              style={{ filter: `blur(${blurPx}px)` }}
              playsInline
              autoPlay={autoplay}
              loop={loop}
              muted={muted}
              poster={resolvedPosterUrl}
              controls={false}
              preload="metadata"
            >
              <source src={resolvedVideoUrl} type="video/mp4" />
            </video>
          )}
        </div>

        <div className="hero-overlay">
          <h1 className="display-5 fw-bold text-white text-center mb-3">{t(lang, 'home.hero.headline')}</h1>
          <p className="lead text-white-50 text-center mb-4">{t(lang, 'home.hero.sub')}</p>
          <div className="d-flex justify-content-center">
            <a href={withTenantPrefix(tenantId, '/menu')} className="btn btn-primary btn-lg">{t(lang, 'home.hero.cta')}</a>
          </div>
        </div>

        <style jsx>{`
          .hero-wrap { position: relative; width: 100%; min-height: 60vh; }
          @media (min-width: 992px) { .hero-wrap { min-height: 75vh; } }
          .hero-media { position: absolute; inset: 0; overflow: hidden; background: #111; }
          .hero-embed { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; object-fit: cover; }
          .hero-embed:not(video) {
            width: 177.78vh; height: 100vh; max-width: none; max-height: none;
            left: 50%; top: 50%; transform: translate(-50%, -50%);
          }
          .hero-overlay {
            position: relative; z-index: 2; display: grid; place-items: center;
            padding: 3rem 1rem; min-height: inherit;
          }
          .hero-overlay::before {
            content: ''; position: absolute; inset: 0;
            background: linear-gradient(to bottom, rgba(0,0,0,0.45) 0%, rgba(0,0,0,0.25) 40%, rgba(0,0,0,0.55) 100%);
            z-index: -1;
          }
        `}</style>
      </header>
    );
  }

  if (v === 'carousel' && slides.length > 1) {
    return (
      <header aria-label={t(lang, 'home.hero.carouselAria')}>
        <div className="position-relative">
          <div className="d-flex overflow-auto" style={{ scrollSnapType: 'x mandatory' }} aria-roledescription="carousel">
            {slides.map((s, i) => {
              const overlayClass =
                s.overlay === 'light' ? 'bg-white bg-opacity-25' :
                s.overlay === 'none' ? '' : 'bg-black bg-opacity-50';

              // ✅ imagen tenant-aware si es relativa
              const slideImg = isAbsoluteUrl(s.imageUrl) ? s.imageUrl : withTenantPrefix(tenantId, s.imageUrl);

              // ✅ CTA tenant-aware si es relativa
              const ctaHref = s.cta?.href
                ? (isAbsoluteUrl(s.cta.href) ? s.cta.href : withTenantPrefix(tenantId, s.cta.href))
                : undefined;

              return (
                <div key={i} className="position-relative flex-shrink-0" style={{ width: '100%', scrollSnapAlign: 'start' }} aria-label={`${t(lang, 'home.hero.slide')} ${i + 1}`}>
                  <div className="ratio ratio-21x9">
                    <Image
                      src={slideImg}
                      alt={s.imageAlt || s.headline || t(lang, 'home.hero.slideAlt')}
                      fill sizes="100vw" priority={i === 0} style={{ objectFit: 'cover' }}
                    />
                  </div>
                  <div className={`position-absolute top-0 start-0 w-100 h-100 ${overlayClass}`} />
                  <div className="position-absolute top-50 start-50 translate-middle text-center text-white px-3">
                    <h1 className="display-5 fw-bold">{s.headline || t(lang, 'home.hero.fallbackHeadline')}</h1>
                    {(s.sub || t(lang, 'home.hero.fallbackSub')) && <p className="lead">{s.sub || t(lang, 'home.hero.fallbackSub')}</p>}
                    {ctaHref && (s.cta?.label || t(lang, 'home.hero.cta')) && (
                      <a href={ctaHref} className="btn btn-primary btn-lg">{s.cta?.label || t(lang, 'home.hero.cta')}</a>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </header>
    );
  }

  const s0 = slides[0] || {
    imageUrl: '/hero-fallback.jpg',
    headline: t(lang, 'home.hero.fallbackHeadline'),
    sub: t(lang, 'home.hero.fallbackSub'),
    overlay: 'dark' as const,
  };
  const overlayClass =
    s0.overlay === 'light' ? 'bg-white bg-opacity-25' :
    s0.overlay === 'none' ? '' : 'bg-black bg-opacity-50';

  // ✅ imagen tenant-aware si es relativa
  const s0img = isAbsoluteUrl(s0.imageUrl) ? s0.imageUrl : withTenantPrefix(tenantId, s0.imageUrl);

  // ✅ CTA tenant-aware si es relativa; fallback /menu tenant-aware
  const s0cta = s0.cta?.href
    ? (isAbsoluteUrl(s0.cta.href) ? s0.cta.href : withTenantPrefix(tenantId, s0.cta.href))
    : withTenantPrefix(tenantId, '/menu');

  return (
    <header className="position-relative" aria-label={t(lang, 'home.hero.imageAria')}>
      <div className="ratio ratio-21x9">
        <Image
          src={s0img}
          alt={s0.imageAlt || s0.headline || t(lang, 'home.hero.imageAlt')}
          fill sizes="100vw" priority style={{ objectFit: 'cover' }}
        />
      </div>
      <div className={`position-absolute top-0 start-0 w-100 h-100 ${overlayClass}`} />
      <div className="position-absolute top-50 start-50 translate-middle text-center text-white px-3">
        <h1 className="display-5 fw-bold">{s0.headline || t(lang, 'home.hero.fallbackHeadline')}</h1>
        {(s0.sub || t(lang, 'home.hero.fallbackSub')) && <p className="lead">{s0.sub || t(lang, 'home.hero.fallbackSub')}</p>}
        {s0cta && (
          <a href={s0cta} className="btn btn-primary btn-lg">{s0.cta?.label || t(lang, 'home.hero.cta')}</a>
        )}
      </div>
    </header>
  );
}
