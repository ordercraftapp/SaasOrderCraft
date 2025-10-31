// src/app/(site)/components/homepage/HeroSection.tsx
"use client";

import React, { useEffect, useState } from "react";
import { ref as storageRef, getDownloadURL } from "firebase/storage";
import { storage } from "@/lib/firebase/client";

export default function HeroSection() {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageOk, setImageOk] = useState<boolean | null>(null);

  useEffect(() => {
    if (!storage) {
      setImageOk(false);
      return;
    }

    const attempts = [
      // Probamos primero la ruta que ya funcionó en tu caso (gs://)
      "gs://ordercraftsaas.firebasestorage.app/hero-image.png",
      // Segundo intento: raíz del bucket (compatibilidad)
      "hero-image.png",
    ];

    (async function tryUrls() {
      for (const path of attempts) {
        try {
          const ref = storageRef(storage, path);
          const url = await getDownloadURL(ref);
          setImageUrl(url);
          setImageOk(true);
          return;
        } catch {
          // ignoramos el error y probamos la siguiente ruta
        }
      }
      setImageOk(false);
    })();
  }, []);

  const heroStyleBase: React.CSSProperties = {
    backgroundSize: "cover",
    backgroundPosition: "center center",
    backgroundAttachment: "scroll",
    minHeight: "80vh",
    position: "relative",
    transition: "background 300ms ease-in-out",
  };

  const backgroundStyle: React.CSSProperties =
    imageUrl && imageOk
      ? { backgroundImage: `url('${imageUrl}')` }
      : { backgroundImage: "linear-gradient(135deg, #0f172a 0%, #0b1220 100%)" };

  const heroStyle = { ...heroStyleBase, ...backgroundStyle };

  const overlayStyle: React.CSSProperties = {
    position: "absolute",
    top: 0,
    left: 0,
    width: "100%",
    height: "100%",
    backgroundColor: "rgba(0,0,0,0.5)",
    zIndex: 1,
  };

  const contentStyle: React.CSSProperties = { position: "relative", zIndex: 2, paddingTop: "3rem", paddingBottom: "3rem" };

  return (
    <section id="hero" className="d-flex align-items-center" style={heroStyle}>
      <div style={overlayStyle}></div>

      <div className="container text-center text-white" style={contentStyle}>
        <h1 className="display-4 fw-bolder mb-3">
          OrderCraft: Control Total, <br className="d-none d-md-inline" />
          <span className="text-warning">Crecimiento Asegurado.</span>
        </h1>

        <p className="lead text-light mb-5" style={{ maxWidth: 700, margin: "0 auto" }}>
          La solución SaaS más eficiente para el manejo de órdenes, cocina y servicio en tu restaurante.
        </p>

        <div className="row justify-content-center mb-3">
            <div className="col-lg-8 col-xl-6">
                
            </div>
            </div>

            {/* CSS inline para placeholder blanco */}
            <style jsx>{`
            .input-group .form-control::placeholder {
                color: #ffffff;
                opacity: 1; /* fuerza que se vea blanco puro */
            }
            `}</style>



        <p className="small text-light mt-3">
          Empieza con <strong>OrderCraft</strong> hoy mismo. Sin tarjeta de crédito.
        </p>
      </div>
    </section>
  );
}
