// src/app/(site)/components/homepage/HeroSection.tsx
"use client";

import React, { useEffect, useState } from "react";
import { ref as storageRef, getDownloadURL } from "firebase/storage";
import { storage, getStorageSafe } from "@/lib/firebase/client";

export default function HeroSection() {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageOk, setImageOk] = useState<boolean | null>(null);
  const [debugMsg, setDebugMsg] = useState<string | null>(null);

  useEffect(() => {
    // Si storage no está inicializado (ej. SSR o init falló), mostramos mensaje y salimos.
    if (!storage) {
      console.error("[HeroSection] Firebase Storage no inicializado en el cliente.");
      setDebugMsg("Firebase Storage no inicializado en el cliente. Revisa src/lib/firebase/client.ts");
      setImageOk(false);
      return;
    }

    const attempts = [
      // Intentos en preferencia: carpeta pública recomendada, luego gs://, luego raíz y otras variantes
      "home/hero/hero-image.png", // <-- recomendado según tus reglas
      "gs://ordercraftsaas.firebasestorage.app/hero-image.png",
      "hero-image.png",
      "images/hero-image.png",
      "hero-image.jpg",
      "images/hero-image.jpg",
    ];

    let tried = 0;

    (async function tryUrls() {
      for (const path of attempts) {
        tried++;
        try {
          console.log(`[HeroSection] Intento ${tried}: getDownloadURL("${path}")`);
          // si path viene con gs:// algunos SDKs rechazan; storageRef soporta ambas formas pero
          // usamos storage exportado para evitar re-inicializaciones
          const ref = storageRef(storage, path);
          const url = await getDownloadURL(ref);
          console.log("[HeroSection] getDownloadURL OK:", url);
          setImageUrl(url);
          setImageOk(true);
          setDebugMsg(`OK: carga desde: ${path}`);
          return;
        } catch (err: any) {
          console.warn(`[HeroSection] Intento ${tried} falló para "${path}" — error:`, err);
          setDebugMsg((prev) =>
            prev ? prev + `\nFail ${tried}: ${path} -> ${err?.code || err?.message || err}` : `Fail ${tried}: ${path} -> ${err?.code || err?.message || err}`
          );
        }
      }
      setImageOk(false);
      console.error("[HeroSection] No se pudo obtener ninguna URL desde Storage. Ver detalles en debugMsg/state.");
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
    imageUrl && imageOk ? { backgroundImage: `url('${imageUrl}')` } : { backgroundImage: "linear-gradient(135deg, #0f172a 0%, #0b1220 100%)" };

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
              <input type="email" placeholder="Ingresa tu email para un demo gratuito..." aria-label="Email para demo" className="form-control border-0 py-3 px-4" style={{ backgroundColor: "rgba(255,255,255,0.95)" }} />
              <button className="btn btn-primary d-flex align-items-center px-4" type="button">
                Solicitar Demo
              </button>
            </div>
          </div>
        </div>

        <p className="small text-light mt-3">
          Empieza con <strong>OrderCraft</strong> hoy mismo. Sin tarjeta de crédito.
        </p>

        {/* Mensajes de debug visibles */}
        <div style={{ position: "absolute", left: 10, bottom: 10, zIndex: 3, textAlign: "left", maxWidth: 420 }}>
          {imageOk === null && <small className="text-light">Comprobando imagen en Firebase Storage...</small>}
          {imageOk === true && <small className="text-success">Imagen de fondo cargada desde Firebase Storage</small>}
          {imageOk === false && <small className="text-warning">No se pudo cargar la imagen desde Storage. Usando fallback.</small>}
          {debugMsg && (
            <pre style={{ color: "#fff", whiteSpace: "pre-wrap", fontSize: 11, marginTop: 6, opacity: 0.9 }}>
              {debugMsg}
            </pre>
          )}
        </div>
      </div>
    </section>
  );
}
