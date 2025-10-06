"use client";
import React, { useEffect, useRef, forwardRef, useImperativeHandle } from "react";

declare global {
  interface Window {
    turnstile?: any;
  }
}

type Props = {
  siteKey: string;
  onToken: (token: string) => void;
};

export type TurnstileWidgetHandle = {
  reset: () => void;
  getToken: () => string | null;
};

// ✅ loader único del script, compartido por todas las instancias
let turnstileScriptPromise: Promise<void> | null = null;
function loadTurnstileScript() {
  if (typeof window === "undefined") return Promise.resolve();
  if (turnstileScriptPromise) return turnstileScriptPromise;

  turnstileScriptPromise = new Promise<void>((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src^="https://challenges.cloudflare.com/turnstile/v0/api.js"]'
    );
    if (existing) {
      if ((window as any).turnstile) resolve();
      else existing.addEventListener("load", () => resolve());
      return;
    }
    const s = document.createElement("script");
    // ✅ render explícito; no usamos onload global
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    document.head.appendChild(s);
  });

  return turnstileScriptPromise;
}

const TurnstileWidget = forwardRef<TurnstileWidgetHandle, Props>(function TurnstileWidget(
  { siteKey, onToken },
  ref
) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const widgetIdRef = useRef<string | null>(null);
  const lastTokenRef = useRef<string | null>(null);

  useImperativeHandle(ref, () => ({
    reset: () => {
      try {
        if (window?.turnstile && widgetIdRef.current) {
          window.turnstile.reset(widgetIdRef.current);
          lastTokenRef.current = null;
        }
      } catch {}
    },
    getToken: () => {
      try {
        if (window?.turnstile && widgetIdRef.current) {
          const t = window.turnstile.getResponse(widgetIdRef.current);
          if (t) lastTokenRef.current = t;
        }
      } catch {}
      return lastTokenRef.current || null;
    },
  }));

  useEffect(() => {
    let cancelled = false;

    (async () => {
      await loadTurnstileScript();
      if (cancelled) return;
      if (!containerRef.current || !window?.turnstile) return;

      // ⚠️ No limpiar si ya existe: evita flicker
      if (!widgetIdRef.current) {
        widgetIdRef.current = window.turnstile.render(containerRef.current, {
          sitekey: siteKey,
          "refresh-expired": "auto",
          "response-field": false,
          theme: "auto",
          callback: (token: string) => {
            lastTokenRef.current = token;
            onToken(token);
          },
          "expired-callback": () => {
            lastTokenRef.current = null;
            onToken("");
          },
          "timeout-callback": () => {
            lastTokenRef.current = null;
            onToken("");
          },
          "error-callback": () => {
            lastTokenRef.current = null;
            onToken("");
          },
        });
      }
    })();

    return () => {
      cancelled = true;
      try {
        if (window?.turnstile && widgetIdRef.current) {
          window.turnstile.remove(widgetIdRef.current);
        }
      } catch {}
      widgetIdRef.current = null;
    };
  }, [siteKey, onToken]);

  return <div ref={containerRef} />;
});

export default TurnstileWidget;
