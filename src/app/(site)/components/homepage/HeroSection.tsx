// src/app/(site)/components/homepage/HeroSection.tsx
///DataCraft Coders 2025 www.datadraftcoders.com

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
      // Insertamos logo desde el storage
      "gs://ordercraftsaas.firebasestorage.app/hero-image.png",
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
          <span className="text-warning">Crecimiento inmediato.</span>
        </h1>

        <p className="lead text-light mb-5" style={{ maxWidth: 700, margin: "0 auto" }}>
          Administra pedidos, cocina, caja y delivery desde una sola plataforma potente y fácil de usar.
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


        <span className="text-warning">Ahorra tiempo. Vende más. Simplifica tu operación.</span>
        <p className="small text-light mt-3">
          Empieza gratis hoy — sin tarjeta de crédito.
        </p>
      </div>
    </section>
  );
}
