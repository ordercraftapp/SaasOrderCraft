// next.config.ts
import type { NextConfig } from "next";
import { buildCSP } from "./src/lib/security/csp";

const isProd = process.env.NODE_ENV === "production";
const baseCsp = buildCSP({ isDev: !isProd });

/**
 * CSP para PRODUCCIÓN (permite inline scripts que requieren PayPal/GTM/Google/Turnstile)
 * Nota: el middleware puede ajustar CSP en runtime con addPaypalToCsp sin romper esta base.
 */
const prodCsp = [
  "default-src 'self'",
  "base-uri 'self'",
  // Scripts (inline permitido por requisitos de GTM/Google/PayPal/Turnstile)
  "script-src 'self' 'unsafe-inline' https://www.gstatic.com https://www.googletagmanager.com https://apis.google.com https://accounts.google.com https://www.paypal.com https://challenges.cloudflare.com",
  "script-src-elem 'self' 'unsafe-inline' https://www.gstatic.com https://www.googletagmanager.com https://apis.google.com https://accounts.google.com https://www.paypal.com https://challenges.cloudflare.com",
  // Estilos (incluye Google Fonts por CSS)
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  // Imágenes
  "img-src 'self' https: data: https://*.gstatic.com https://*.googleapis.com https://www.paypalobjects.com https://www.paypal.com https://www.sandbox.paypal.com https://i.ytimg.com https://i.vimeocdn.com",
  // Fuentes
  "font-src 'self' data: https://fonts.gstatic.com",
  // Fetch/XHR/WebSocket
  "connect-src 'self' https://securetoken.googleapis.com https://www.googleapis.com https://identitytoolkit.googleapis.com https://firestore.googleapis.com https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://apis.google.com https://accounts.google.com https://www.gstatic.com https://www.paypal.com https://www.sandbox.paypal.com",
  // iframes embebidos (PayPal/Turnstile/YouTube/Vimeo/Google)
  "frame-src 'self' https://*.firebaseapp.com https://*.google.com https://*.gstatic.com https://accounts.google.com https://apis.google.com https://www.paypal.com https://www.sandbox.paypal.com https://challenges.cloudflare.com https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com",
  // Seguridad adicional
  "frame-ancestors 'none'",
  "form-action 'self' https://accounts.google.com",
  // Media (p.ej. videos en Firebase Storage)
  "media-src 'self' blob: https://firebasestorage.googleapis.com",
  // Mejora de seguridad para HTTP→HTTPS (no afecta local)
  "upgrade-insecure-requests",
].join("; ");

/**
 * CSP para DESARROLLO (más relajada para HMR y DevTools)
 */
const devCsp = [
  "default-src 'self'",
  "base-uri 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval' blob: https://www.gstatic.com https://www.googletagmanager.com https://apis.google.com https://accounts.google.com https://www.paypal.com https://challenges.cloudflare.com",
  "script-src-elem 'self' 'unsafe-inline' 'unsafe-eval' blob: https://www.gstatic.com https://www.googletagmanager.com https://apis.google.com https://accounts.google.com https://www.paypal.com https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "img-src 'self' https: data: https://*.gstatic.com https://*.googleapis.com https://www.paypalobjects.com https://www.paypal.com https://www.sandbox.paypal.com https://i.ytimg.com https://i.vimeocdn.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:* https://securetoken.googleapis.com https://www.googleapis.com https://identitytoolkit.googleapis.com https://firestore.googleapis.com https://*.googleapis.com https://*.firebaseio.com wss://*.firebaseio.com https://apis.google.com https://accounts.google.com https://www.gstatic.com https://www.paypal.com https://www.sandbox.paypal.com",
  "frame-src 'self' https://*.firebaseapp.com https://*.google.com https://*.gstatic.com https://accounts.google.com https://apis.google.com https://www.paypal.com https://www.sandbox.paypal.com https://challenges.cloudflare.com https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com",
  "frame-ancestors 'none'",
  "form-action 'self' https://accounts.google.com",
  "media-src 'self' blob: https://firebasestorage.googleapis.com",
].join("; ");

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Content-Security-Policy", value: baseCsp },
];

const nextConfig: NextConfig = {
  // Compatible con Vercel (no usar 'export' para no romper Middleware)
  output: "standalone",

  experimental: {
    ppr: false,
    serverActions: {
      allowedOrigins: ["localhost:3000"],
      bodySizeLimit: "2mb",
    },
  },

  images: {
    remotePatterns: [
      { protocol: "https", hostname: "firebasestorage.googleapis.com" },
      { protocol: "https", hostname: "lh3.googleusercontent.com" },
      { protocol: "https", hostname: "i.ytimg.com" },
      { protocol: "https", hostname: "i.vimeocdn.com" },
    ],
  },

  // Workarounds seguros en Vercel
  generateEtags: false,
  trailingSlash: false,
  compress: true,

  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },

  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
