// src/app/(site)/components/homepage/HeroSection.tsx
"use client";

import React, { useEffect, useState } from "react";
import { getStorage, ref as storageRef, getDownloadURL } from "firebase/storage";
// Si ya exportas `storage` desde tu init client, importa en lugar de getStorage()
// import { storage } from "@/lib/firebase/client";

export default function HeroSection() {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageOk, setImageOk] = useState<boolean | null>(null); // null = comprobando

  useEffect(() => {
    // 1) Obtén la instancia de Storage (reemplaza si ya exportas `storage` desde tu init)
    const storage = getStorage(); // usa getStorage(app) si necesitas pasar el app
    // 2) Crea la referencia. Podemos usar la URL gs:// completa con storageRef(storage, gsUrl)
    const gsUrl = "gs://ordercraftsaas.firebasestorage.app/hero-image.png";
    const ref = storageRef(storage, gsUrl);

    console.log("[HeroSection] solicitando getDownloadURL para", gsUrl);

    getDownloadURL(ref)
      .then((url) => {
        console.log("[HeroSection] getDownloadURL OK:", url);
        setImageUrl(url);
        setImageOk(true);
      })
      .catch((err) => {
        console.error("[HeroSection] getDownloadURL ERROR:", err);
        // errores típicos: permisos (rules), CORS, path incorrecto, archivo no subido
        setImageOk(false);
        setImageUrl(null);
      });
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
            <div className="input-group input-group-lg shadow rounded-pill overflow-hidden">
              <input
                type="email"
                placeholder="Ingresa tu email para un demo gratuito..."
                aria-label="Email para demo"
                className="form-control border-0 py-3 px-4"
                style={{ backgroundColor: "rgba(255,255,255,0.95)" }}
              />
              <button className="btn btn-primary d-flex align-items-center px-4" type="button">
                Solicitar Demo
              </button>
            </div>
          </div>
        </div>

        <p className="small text-light mt-3">
          Empieza con <strong>OrderCraft</strong> hoy mismo. Sin tarjeta de crédito.
        </p>

        <div style={{ position: "absolute", left: 10, bottom: 10, zIndex: 3 }}>
          {imageOk === null && <small className="text-light">Comprobando imagen en Firebase Storage...</small>}
          {imageOk === true && <small className="text-success">Imagen de fondo cargada desde Firebase Storage</small>}
          {imageOk === false && <small className="text-warning">No se pudo cargar la imagen desde Storage. Usando fallback.</small>}
        </div>
      </div>
    </section>
  );
}
