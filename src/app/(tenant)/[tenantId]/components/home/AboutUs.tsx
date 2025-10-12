// src/app/(tenant)/[tenantId]/components/home/AboutUs.tsx
"use client";

import Image from "next/image";
import React from "react";
import { useTenantId } from "@/lib/tenant/context"; // ✅ tenant

export default function AboutUs({
  title,
  text,
  imageUrl,
}: {
  title?: string;
  text?: string;
  imageUrl?: string;
}) {
  const tenantId = useTenantId();

  // Si no hay nada que mostrar, no renderizamos la sección
  if (!title && !text && !imageUrl) return null;

  // ✅ Si la imagen es relativa, prefijamos /_t/{tenantId}; si es absoluta, se deja igual.
  const resolvedImageUrl = React.useMemo(() => {
    if (!imageUrl) return undefined;
    const isAbsolute = /^(https?:)?\/\//i.test(imageUrl) || imageUrl.startsWith("data:");
    if (isAbsolute || !tenantId) return imageUrl;
    const norm = imageUrl.startsWith("/") ? imageUrl : `/${imageUrl}`;
    const base = `/_t/${tenantId}`;
    return norm.startsWith(`${base}/`) ? norm : `${base}${norm}`;
  }, [imageUrl, tenantId]);

  return (
    <section
      id="aboutus"
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
          {resolvedImageUrl && (
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
                      src={resolvedImageUrl}
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
