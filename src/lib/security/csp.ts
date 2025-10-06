/**
 * Genera el valor del header Content-Security-Policy.
 * - En dev agrega localhost/127.0.0.1 y WS para emuladores/hmr.
 * - Incluye los endpoints necesarios para Firebase Auth + Firestore.
 * - En prod puedes quitar 'unsafe-eval' si no usas librerías que lo requieran.
 */
export function buildCSP({ isDev = false }: { isDev?: boolean } = {}) {
  const connectSrc = [
    "'self'",
    "https://securetoken.googleapis.com",
    "https://www.googleapis.com",
    "https://identitytoolkit.googleapis.com",
    "https://firestore.googleapis.com",
    "https://*.googleapis.com",
    "https://*.firebaseio.com",
    "wss://*.firebaseio.com",
    "https://www.youtube.com" // ✅ corregido: antes tenía una coma dentro de la cadena
  ];

  // ➕ AÑADIDOS (no destructivo): orígenes correctos para embeds y APIs de video
  connectSrc.push(
    "https://www.youtube-nocookie.com",
    "https://player.vimeo.com"
  );

  if (isDev) {
    connectSrc.push(
      "http://localhost:*",
      "http://127.0.0.1:*",
      "ws://localhost:*",
      "ws://127.0.0.1:*"
    );
  }

  // Construimos script-src (base + turnstile)
  const scriptSrc = [
    "'self'",
    "'unsafe-inline'",
    "'unsafe-eval'",
    "https://www.gstatic.com",
    "https://www.googletagmanager.com",
    "https://challenges.cloudflare.com",
  ].join(" ");

  const directives = [
    `default-src 'self'`,
    `base-uri 'self'`,
    // ⬇️ se mantiene tu línea original y se agregan hosts de miniaturas YouTube/Vimeo
    `img-src 'self' data: https://*.gstatic.com https://*.googleapis.com https://i.ytimg.com https://i.vimeocdn.com`,
    // Nota: 'unsafe-inline' y 'unsafe-eval' facilitan dev. En prod, intenta remover 'unsafe-eval'.
    `script-src ${scriptSrc}`,
    // ✅ nuevo: algunos navegadores requieren script-src-elem explícito
    `script-src-elem ${scriptSrc}`,
    `style-src 'self' 'unsafe-inline'`,
    `connect-src ${connectSrc.join(" ")}`,
    // 👇 AGREGADO Turnstile en frame-src + YouTube/Vimeo
    `frame-src https://*.firebaseapp.com https://*.google.com https://*.gstatic.com https://challenges.cloudflare.com https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com`,
    // ✅ nuevo: child-src espeja frame-src para compatibilidad
    `child-src https://*.firebaseapp.com https://*.google.com https://*.gstatic.com https://challenges.cloudflare.com https://www.youtube.com https://www.youtube-nocookie.com https://player.vimeo.com`,
    `font-src 'self' data:`,
    `form-action 'self'`,
    // (tu csp original tenía 'frame-ancestors self' aquí; lo conservamos)
    `frame-ancestors 'self'`,
    // ➕ NUEVO (recomendado para workers/retos y para reproducir MP4 desde Firebase Storage)
    `worker-src 'self' blob:`,
    `media-src 'self' blob: https://firebasestorage.googleapis.com`,
  ];

  return directives.join("; ");
}

// --- 👇 AGREGAR AL FINAL DE src/lib/security/csp.ts (sin tocar lo existente) ---

/**
 * Agrega los orígenes requeridos por PayPal a un header CSP existente
 * manteniendo todo lo previo (merge no destructivo).
 */
export function addPaypalToCsp(existingHeader: string): string {
  type CspMap = Record<string, Set<string>>;

  // PayPal: orígenes mínimos
  const PAYPAL: Record<string, string[]> = {
    'script-src':      ['https://www.paypal.com'],
    'script-src-elem': ['https://www.paypal.com'],
    'connect-src':     ['https://www.paypal.com', 'https://www.sandbox.paypal.com'],
    'frame-src':       ['https://www.paypal.com', 'https://www.sandbox.paypal.com'],
    'img-src':         ['https://www.paypalobjects.com', 'https://www.paypal.com', 'https://www.sandbox.paypal.com'],
  };

  const parse = (h: string): CspMap => {
    const map: CspMap = {};
    if (!h) return map;
    for (const raw of h.split(';')) {
      const s = raw.trim();
      if (!s) continue;
      const parts = s.split(/\s+/);
      const name = parts.shift()!;
      if (!name) continue;
      map[name] = map[name] || new Set<string>();
      for (const src of parts) map[name].add(src);
    }
    return map;
  };

  const serialize = (m: CspMap): string =>
    Object.entries(m)
      .filter(([, set]) => set?.size)
      .map(([k, set]) => `${k} ${Array.from(set).join(' ')}`)
      .join('; ');

  const ensure = (m: CspMap, d: string) => { if (!m[d]) m[d] = new Set<string>(); };

  const add = (m: CspMap, d: string, sources: string[]) => {
    ensure(m, d);
    for (const s of sources) m[d].add(s);
  };

  // 1) Parsear CSP actual
  const map = parse(existingHeader || '');

  // 2) Añadir fuentes de PayPal (no destruye lo previo)
  for (const [dir, arr] of Object.entries(PAYPAL)) add(map, dir, arr);

  // 3) img-src: asegurar data:/blob: (render de logos/iframes)
  add(map, 'img-src', ['data:', 'blob:']);

  // 4) Si existe frame-src, replicar en child-src por compatibilidad
  if (map['frame-src']) {
    ensure(map, 'child-src');
    for (const v of map['frame-src']) map['child-src'].add(v);
  }

  // 5) Si no existe script-src-elem, copiar de script-src
  if (!map['script-src-elem'] && map['script-src']) {
    map['script-src-elem'] = new Set(map['script-src']);
  }

  return serialize(map);
}

/* ➕ OPCIONAL: helper para añadir YouTube/Vimeo a una CSP existente sin tocar lo previo */
export function addVideoEmbedsToCsp(existingHeader: string): string {
  type CspMap = Record<string, Set<string>>;

  const EXTRAS: Record<string, string[]> = {
    'frame-src': ['https://www.youtube.com', 'https://www.youtube-nocookie.com', 'https://player.vimeo.com'],
    'img-src': ['https://i.ytimg.com', 'https://i.vimeocdn.com', 'data:', 'blob:'],
    'media-src': ["'self'", 'blob:', 'https://firebasestorage.googleapis.com'],
    'connect-src': ['https://www.youtube.com', 'https://www.youtube-nocookie.com', 'https://player.vimeo.com'],
  };

  const parse = (h: string): CspMap => {
    const map: CspMap = {};
    if (!h) return map;
    for (const raw of h.split(';')) {
      const s = raw.trim();
      if (!s) continue;
      const parts = s.split(/\s+/);
      const name = parts.shift()!;
      if (!name) continue;
      map[name] = map[name] || new Set<string>();
      for (const src of parts) map[name].add(src);
    }
    return map;
  };

  const serialize = (m: CspMap): string =>
    Object.entries(m)
      .filter(([, set]) => set?.size)
      .map(([k, set]) => `${k} ${Array.from(set).join(' ')}`)
      .join('; ');

  const ensure = (m: CspMap, d: string) => { if (!m[d]) m[d] = new Set<string>(); };
  const add = (m: CspMap, d: string, sources: string[]) => {
    ensure(m, d);
    for (const s of sources) m[d].add(s);
  };

  const map = parse(existingHeader || '');
  for (const [dir, arr] of Object.entries(EXTRAS)) add(map, dir, arr);
  return serialize(map);
}
