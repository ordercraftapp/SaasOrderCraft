/**
 * CSP utils para site + tenant (Next.js + Vercel)
 * - buildCSP(): genera una CSP base (dev/prod) para poner en next.config.ts (headers()).
 * - addPaypalToCsp(): extiende una CSP existente con orígenes de PayPal (merge no destructivo).
 * - addVideoEmbedsToCsp(): añade orígenes para YouTube/Vimeo sin romper lo previo.
 *
 * Nota: El middleware puede leer el header "Content-Security-Policy" actual y
 * aplicarle addPaypalToCsp() solo donde haga falta (páginas públicas), como ya haces.
 */

type CspMap = Record<string, Set<string>>;

// ------------------------------
// 1) Generar CSP base (dev/prod)
// ------------------------------
export function buildCSP({ isDev = false, includeBrevo = true }: { isDev?: boolean; includeBrevo?: boolean } = {}) {
  // --- connect-src ---
  const connectSrc = new Set<string>([
    "'self'",
    // Firebase Auth / Firestore / Token
    "https://securetoken.googleapis.com",
    "https://www.googleapis.com",
    "https://identitytoolkit.googleapis.com",
    "https://firestore.googleapis.com",
    "https://*.googleapis.com",
    "https://*.firebaseio.com",
    "wss://*.firebaseio.com",
    // Google identity widgets / gstatic
    "https://apis.google.com",
    "https://accounts.google.com",
    "https://www.gstatic.com",
    // PayPal (se complementa en addPaypalToCsp)
    "https://www.paypal.com",
    "https://www.sandbox.paypal.com",
    // Embeds de vídeo (útil si haces fetch a sus endpoints)
    "https://www.youtube.com",
    "https://www.youtube-nocookie.com",
    "https://player.vimeo.com",
    // ✅ Turnstile
    "https://challenges.cloudflare.com",
  ]);

  if (includeBrevo) {
    // Brevo (API pública)
    connectSrc.add("https://api.brevo.com");
  }

  if (isDev) {
    for (const host of ["localhost", "127.0.0.1"]) {
      connectSrc.add(`http://${host}:*`);
      connectSrc.add(`ws://${host}:*`);
    }
  }

  // --- script-src / script-src-elem ---
  // Mantén 'unsafe-inline' y (solo dev) 'unsafe-eval' si lo necesitas para HMR o librerías dev
  const scriptBase = [
    "'self'",
    "'unsafe-inline'",
    ...(isDev ? ["'unsafe-eval'", "blob:"] : []),
    "https://www.gstatic.com",
    "https://www.googletagmanager.com",
    "https://apis.google.com",
    "https://accounts.google.com",
    "https://www.paypal.com", // complementado por addPaypalToCsp
    "https://challenges.cloudflare.com",
  ].join(" ");

  // --- style-src / fonts ---
  // Incluye Google Fonts si los cargas por CSS
  const styleSrc = ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"].join(" ");
  const fontSrc = ["'self'", "data:", "https://fonts.gstatic.com"].join(" ");

  // --- img-src ---
  const imgSrc = [
    "'self'",
    "https:",
    "data:",
    "blob:",
    "https://*.gstatic.com",
    "https://*.googleapis.com",
    "https://www.paypalobjects.com",
    "https://www.paypal.com",
    "https://www.sandbox.paypal.com",
    "https://i.ytimg.com",
    "https://i.vimeocdn.com",
    // ✅ Turnstile
    "https://challenges.cloudflare.com",
  ].join(" ");

  // --- frame-src / child-src ---
  const frameSrc = [
    "'self'",
    "https://*.firebaseapp.com",
    "https://*.google.com",
    "https://*.gstatic.com",
    "https://accounts.google.com",
    "https://apis.google.com",
    "https://www.paypal.com",
    "https://www.sandbox.paypal.com",
    "https://challenges.cloudflare.com",
    "https://www.youtube.com",
    "https://www.youtube-nocookie.com",
    "https://player.vimeo.com",
  ].join(" ");

  // --- worker-src / media-src ---
  const workerSrc = ["'self'", "blob:"].join(" ");
  const mediaSrc = ["'self'", "blob:", "https://firebasestorage.googleapis.com"].join(" ");

  const directives = [
    "default-src 'self'",
    "base-uri 'self'",
    `script-src ${scriptBase}`,
    `script-src-elem ${scriptBase}`,
    `style-src ${styleSrc}`,
    `img-src ${imgSrc}`,
    `font-src ${fontSrc}`,
    `connect-src ${Array.from(connectSrc).join(" ")}`,
    `frame-src ${frameSrc}`,
    // por compat: child-src ≈ frame-src
    `child-src ${frameSrc}`,
    // Anti-embed por seguridad (cámbialo a 'self' si NECESITAS embeber tu app)
    "frame-ancestors 'none'",
    // Si publicas formularios a Google Accounts
    "form-action 'self' https://accounts.google.com",
    `worker-src ${workerSrc}`,
    `media-src ${mediaSrc}`,
    // Fuerza HTTPS en prod (los navegadores la ignoran en localhost)
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ];

  return directives.join("; ");
}

// ----------------------------------------------------
// 2) Merge no destructivo de PayPal sobre una CSP dada
// ----------------------------------------------------
export function addPaypalToCsp(existingHeader: string): string {
  const PAYPAL: Record<string, string[]> = {
    "script-src": ["https://www.paypal.com"],
    "script-src-elem": ["https://www.paypal.com"],
    "connect-src": ["https://www.paypal.com", "https://www.sandbox.paypal.com"],
    "frame-src": ["https://www.paypal.com", "https://www.sandbox.paypal.com"],
    "img-src": ["https://www.paypalobjects.com", "https://www.paypal.com", "https://www.sandbox.paypal.com", "data:", "blob:"],
  };

  const map = parseCsp(existingHeader);
  for (const [dir, arr] of Object.entries(PAYPAL)) addToDir(map, dir, arr);

  // Si no existe script-src-elem, copiar de script-src
  if (!map["script-src-elem"] && map["script-src"]) {
    map["script-src-elem"] = new Set(map["script-src"]);
  }
  // Por compat: child-src espejo de frame-src
  if (map["frame-src"]) {
    map["child-src"] = map["child-src"] || new Set();
    for (const v of map["frame-src"]) map["child-src"].add(v);
  }

  return serializeCsp(map);
}

// ----------------------------------------------------------------
// 3) Extras para video (YouTube/Vimeo) sin tocar lo ya configurado
// ----------------------------------------------------------------
export function addVideoEmbedsToCsp(existingHeader: string): string {
  const EXTRAS: Record<string, string[]> = {
    "frame-src": ["https://www.youtube.com", "https://www.youtube-nocookie.com", "https://player.vimeo.com"],
    "img-src": ["https://i.ytimg.com", "https://i.vimeocdn.com", "data:", "blob:"],
    "media-src": ["'self'", "blob:", "https://firebasestorage.googleapis.com"],
    "connect-src": ["https://www.youtube.com", "https://www.youtube-nocookie.com", "https://player.vimeo.com"],
  };

  const map = parseCsp(existingHeader);
  for (const [dir, arr] of Object.entries(EXTRAS)) addToDir(map, dir, arr);
  return serializeCsp(map);
}

// -------------------------
// Helpers de parse/serialize
// -------------------------
function parseCsp(header: string): CspMap {
  const map: CspMap = {};
  if (!header) return map;
  for (const raw of header.split(";")) {
    const s = raw.trim();
    if (!s) continue;
    const parts = s.split(/\s+/);
    const name = parts.shift()!;
    if (!name) continue;
    map[name] = map[name] || new Set<string>();
    for (const src of parts) map[name].add(src);
  }
  return map;
}

function addToDir(map: CspMap, dir: string, sources: string[]) {
  map[dir] = map[dir] || new Set<string>();
  for (const s of sources) map[dir].add(s);
}

function serializeCsp(map: CspMap): string {
  return Object.entries(map)
    .filter(([, set]) => set && set.size)
    .map(([k, set]) => `${k} ${Array.from(set).join(" ")}`)
    .join("; ");
}
