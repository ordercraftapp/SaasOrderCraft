// src/components/home/AboutUs.tsx
"use client";

import Image from "next/image";

export default function AboutUs({
  title,
  text,
  imageUrl,
}: {
  title?: string;
  text?: string;
  imageUrl?: string;
}) {
  // Si no hay nada que mostrar, no renderizamos la sección
  if (!title && !text && !imageUrl) return null;

  return (
    <section id="aboutus"
      className="position-relative py-5 py-md-6 overflow-hidden"
      aria-labelledby="about-heading"
      style={{
        background:
          "radial-gradient(1200px 600px at -10% -20%, rgba(255,220,180,.35), transparent 60%), radial-gradient(900px 500px at 110% 20%, rgba(180,220,255,.35), transparent 60%)",
      }}
    >
      <div className="container position-relative">
        <div className="row align-items-center g-4 g-lg-5">
          {/* Texto */}
          <div className="col-12 col-lg-7">
            {/* SOLO tu título del admin, sin i18n ni “kicker” */}
            {title && (
              <h2 id="about-heading" className="display-6 fw-bold mb-3">
                {title}
              </h2>
            )}

            {/* SOLO tu texto del admin */}
            {text && (
              <p className="lead mb-4" style={{ lineHeight: 1.6 }}>
                {text}
              </p>
            )}
          </div>

          {/* Imagen (opcional) */}
          {imageUrl && (
            <div className="col-12 col-lg-5">
              <div className="position-relative mx-auto" style={{ maxWidth: 420 }}>
                <div
                  className="rounded-4 shadow-lg border"
                  style={{ transform: "rotate(2deg)", background: "#fff", padding: 12 }}
                >
                  <div
                    className="position-relative rounded-3 overflow-hidden"
                    style={{ width: "100%", height: 0, paddingBottom: "120%" }}
                  >
                    <Image
                      src={imageUrl}
                      alt={title || "About image"}
                      fill
                      loading="lazy"
                      sizes="(max-width: 768px) 90vw, 420px"
                      style={{ objectFit: "cover" }}
                    />
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* franja diagonal decorativa */}
      <div
        className="position-absolute start-0 end-0"
        style={{
          bottom: -30,
          height: 60,
          transform: "skewY(-2deg)",
          background:
            "linear-gradient(90deg, rgba(255,255,255,.0), rgba(0,0,0,.05), rgba(255,255,255,.0))",
        }}
        aria-hidden="true"
      />
    </section>
  );
}
