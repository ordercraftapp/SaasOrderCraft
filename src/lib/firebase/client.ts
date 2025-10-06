// src/lib/firebase/client.ts
import { initializeApp, getApps, getApp } from "firebase/app";
import {
  initializeAuth,
  getAuth,
  GoogleAuthProvider,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  inMemoryPersistence,
  browserPopupRedirectResolver,
  setPersistence,
  type Auth,
} from "firebase/auth";

/** 🔊 Logs solo en dev (usados solo para errores/fallbacks) */
const devWarn = (...args: any[]) => {
  if (process.env.NODE_ENV === "development") {
    console.warn("[dev]", ...args);
  }
};

/** Detecta TimeoutError típico de IndexedDB */
const isIdbTimeout = (e: unknown) =>
  (e as any)?.code === 23 ||
  (e as any)?.name === "TimeoutError" ||
  (e as any)?.message?.includes?.("aborted due to timeout");

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
};

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

let _auth: Auth;

/**
 * ⚙️ Estrategia:
 * - Inicializa Auth en memoria para evitar que Firebase pruebe IDB automáticamente.
 * - Luego intenta mejorar la persistencia sin loguear éxitos:
 *   - Primero localStorage, luego IndexedDB (o al revés si se setea preferencia por ENV).
 *   - Si falla, se queda en memoria.
 * - Solo se muestran warnings en dev cuando hay errores/fallbacks.
 */
async function safelyUpgradePersistence(auth: Auth) {
  const preferIDB = process.env.NEXT_PUBLIC_FIREBASE_PREFER_IDB === "1";

  // helper: intenta setPersistence SIN log de éxito; solo loguea fallos
  const trySet = async (p: any, label: string) => {
    try {
      await setPersistence(auth, p);
      return true; // éxito silenciado
    } catch (e) {
      if (isIdbTimeout(e)) {
        devWarn(`[firebase] ${label} timed out; falling back`);
      } else {
        devWarn(`[firebase] setPersistence ${label} failed; falling back`, e);
      }
      return false;
    }
  };

  if (preferIDB) {
    // 1) IDB → 2) localStorage → 3) memory
    if (await trySet(indexedDBLocalPersistence, "indexedDB")) return;
    if (await trySet(browserLocalPersistence, "localStorage")) return;
  } else {
    // 1) localStorage → 2) IDB → 3) memory
    if (await trySet(browserLocalPersistence, "localStorage")) return;
    if (await trySet(indexedDBLocalPersistence, "indexedDB")) return;
  }
  // inMemory ya está activo; no logueamos éxito
}

if (typeof window !== "undefined") {
  try {
    // Si ya estaba inicializado (Fast Refresh), úsalo
    _auth = getAuth(app);
  } catch {
    // Evitamos que Firebase intente IDB de entrada
    _auth = initializeAuth(app, {
      persistence: inMemoryPersistence,
      popupRedirectResolver: browserPopupRedirectResolver,
    });
  }

  // Idioma del dispositivo
  _auth.useDeviceLanguage?.();

  // Mejora de persistencia (no bloqueante, sin logs de éxito)
  void safelyUpgradePersistence(_auth);
} else {
  // SSR/Node: devolver instancia si existe, sin inicializar nada de navegador
  _auth = getAuth(app);
}

export const auth = _auth;

export const googleProvider = new GoogleAuthProvider();
googleProvider.addScope("email");
googleProvider.addScope("profile");
googleProvider.setCustomParameters({ prompt: "select_account" });

/**
 * 👇 Helper existente: asegura persistencia LOCAL antes de redirect y de leer el resultado.
 * Se mantiene igual; solo se loguea si hay fallo y estamos en dev.
 */
export async function ensureLocalPersistence() {
  if (typeof window === "undefined") return;
  try {
    await setPersistence(auth, browserLocalPersistence);
  } catch (e) {
    devWarn("[firebase] ensureLocalPersistence failed; using inMemory", e);
    try {
      await setPersistence(auth, inMemoryPersistence);
    } catch {
      // Último fallback: ya estamos en memoria desde el init
    }
  }
}
