// src/components/home/Gallery.tsx
'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';

type GalleryImage = { url: string; alt?: string };

type Props = {
  images: GalleryImage[];
  intervalMs?: number;      // tiempo entre slides
  pauseOnHover?: boolean;   // pausa al pasar el mouse
  aspect?: '16x9' | '4x3' | '1x1';
};

export default function Gallery({
  images,
  intervalMs = 3500,
  pauseOnHover = true,
  aspect = '16x9',
}: Props) {
  const hasSlides = Array.isArray(images) && images.length > 0;
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [idx, setIdx] = useState(0);
  const [paused, setPaused] = useState(false);
  const [inView, setInView] = useState(true); // autoplay solo si visible
  const [containerWidth, setContainerWidth] = useState(0);
  const [focused, setFocused] = useState(false); // teclado solo con foco

  const ratioClass = useMemo(() => {
    switch (aspect) {
      case '1x1': return 'ratio-1x1';
      case '4x3': return 'ratio-4x3';
      default:    return 'ratio-16x9';
    }
  }, [aspect]);

  // Visibilidad en viewport
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (!entries.length) return;
        setInView(entries[0].isIntersecting);
      },
      { threshold: 0.1 } // más permisivo
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Observar ancho del contenedor (responsive)
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setContainerWidth(el.clientWidth);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Auto-advance (solo si hay varios, no está en pausa y está visible)
  useEffect(() => {
    if (!hasSlides || images.length < 2) return;
    if (paused || !inView) return;
    const t = setInterval(() => {
      setIdx((i) => (i + 1) % images.length);
    }, intervalMs);
    return () => clearInterval(t);
  }, [images.length, intervalMs, paused, inView, hasSlides]);

  // Desplazar SOLO el contenedor usando el ancho del contenedor
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const left = idx * containerWidth;
    el.scrollTo({ left, behavior: 'smooth' });
  }, [idx, containerWidth]);

  // Teclado: solo cuando el carrusel tiene foco
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (!focused) return;
    if (e.key === 'ArrowRight') {
      e.preventDefault();
      setIdx((i) => (i + 1) % images.length);
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      setIdx((i) => (i - 1 + images.length) % images.length);
    }
  };

  if (!hasSlides) return null;

  const prev = () => setIdx((i) => (i - 1 + images.length) % images.length);
  const next = () => setIdx((i) => (i + 1) % images.length);

  return (
    <div
      className="position-relative"
      onMouseEnter={() => pauseOnHover && setPaused(true)}
      onMouseLeave={() => pauseOnHover && setPaused(false)}
      onFocus={() => setFocused(true)}
      onBlur={() => setFocused(false)}
      onKeyDown={onKeyDown}
      tabIndex={0}
      aria-label="Gallery carousel"
      role="region"
    >
      {/* Carrusel scroll-snap (mobile friendly + swipe) */}
      <div
        ref={containerRef}
        className="d-flex overflow-auto"
        style={{
          scrollSnapType: 'x mandatory',
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
        }}
        aria-roledescription="carousel"
      >
        {/* Oculta scrollbar (webkit) */}
        <style>{`
          [aria-roledescription="carousel"]::-webkit-scrollbar { display: none; }
        `}</style>

        {images.map((g, i) => (
          <div
            key={`${g.url}-${i}`}
            className="flex-shrink-0"
            style={{
              width: '100%',           // cada slide ocupa exactamente el ancho visible
              scrollSnapAlign: 'start',
            }}
            aria-label={`Slide ${i + 1} de ${images.length}`}
          >
            <figure className="card border-0 shadow-sm rounded-4 overflow-hidden mb-0">
              <div className={`ratio ${ratioClass}`}>
                <Image
                  src={g.url}
                  alt={g.alt || `Gallery image ${i + 1}`}
                  fill
                  priority={i === 0}
                  sizes="100vw"
                  loading={i === 0 ? 'eager' : 'lazy'}
                  style={{ objectFit: 'cover' }}
                />
              </div>
              {g.alt && (
                <figcaption className="position-absolute bottom-0 start-0 end-0 p-3">
                  <span className="badge bg-dark bg-opacity-75 text-light rounded-pill px-3 py-2">
                    {g.alt}
                  </span>
                </figcaption>
              )}
            </figure>
          </div>
        ))}
      </div>

      {/* Flechas (overlay) */}
      {images.length > 1 && (
        <>
          <button
            type="button"
            className="btn btn-light btn-lg position-absolute top-50 start-0 translate-middle-y shadow rounded-circle border"
            aria-label="Anterior"
            onClick={prev}
            style={{ opacity: 0.9 }}
          >
            ‹
          </button>
          <button
            type="button"
            className="btn btn-light btn-lg position-absolute top-50 end-0 translate-middle-y shadow rounded-circle border"
            aria-label="Siguiente"
            onClick={next}
            style={{ opacity: 0.9 }}
          >
            ›
          </button>
        </>
      )}

      {/* Dots */}
      {images.length > 1 && (
        <div className="d-flex justify-content-center gap-2 mt-3">
          {images.map((_, i) => (
            <button
              key={i}
              type="button"
              aria-label={`Ir al slide ${i + 1}`}
              className={`p-0 border-0 rounded-circle ${i === idx ? 'bg-dark' : 'bg-secondary'}`}
              onClick={() => setIdx(i)}
              style={{ width: 10, height: 10, opacity: i === idx ? 0.95 : 0.5 }}
            />
          ))}
        </div>
      )}
    </div>
  );
}
