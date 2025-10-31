// src/lib/firebase/client.ts
import { initializeApp, getApps, getApp } from "firebase/app";
import {
  initializeAuth,
  getAuth,
  indexedDBLocalPersistence,
  browserLocalPersistence,
  inMemoryPersistence,
  browserPopupRedirectResolver,
  setPersistence,
  type Auth,
} from "firebase/auth";
import { getStorage, type FirebaseStorage } from "firebase/storage";

/** 🔊 Logs solo en dev */
const devWarn = (...args: any[]) => {
  if (process.env.NODE_ENV === "development") {
    console.warn("[dev]", ...args);
  }
};

const isIdbTimeout = (e: unknown) =>
  (e as any)?.code === 23 ||
  (e as any)?.name === "TimeoutError" ||
  (e as any)?.message?.includes?.("aborted due to timeout");

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!, // revisa valor en .env
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
};

/**
 * Inicializa (o devuelve) la app Firebase ya inicializada.
 * Mantengo tu export existente `app` para compatibilidad.
 */
export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
export const firebaseApp = app; // alias por compatibilidad si se usa otro nombre

let _auth: Auth;

/**
 * Trata de aplicar la persistencia "mejor" posible sin romper en entornos donde
 * IndexedDB da timeout (Safari Private mode, etc).
 */
async function safelyUpgradePersistence(auth: Auth) {
  const preferIDB = process.env.NEXT_PUBLIC_FIREBASE_PREFER_IDB === "1";
  const trySet = async (p: any, label: string) => {
    try {
      await setPersistence(auth, p);
      return true;
    } catch (e) {
      if (isIdbTimeout(e)) devWarn(`[firebase] ${label} timed out; falling back`);
      else devWarn(`[firebase] setPersistence ${label} failed; falling back`, e);
      return false;
    }
  };

  if (preferIDB) {
    if (await trySet(indexedDBLocalPersistence, "indexedDB")) return;
    if (await trySet(browserLocalPersistence, "localStorage")) return;
  } else {
    if (await trySet(browserLocalPersistence, "localStorage")) return;
    if (await trySet(indexedDBLocalPersistence, "indexedDB")) return;
  }
  // inMemory ya activo si todo falla
}

/**
 * Inicialización segura de auth (cliente vs server).
 * En server apenas llamamos getAuth(app) para que las importaciones que lo requieran no rompan;
 * para el cliente tratamos de usar initializeAuth y luego mejorar la persistencia.
 */
if (typeof window !== "undefined") {
  try {
    _auth = getAuth(app);
  } catch {
    _auth = initializeAuth(app, {
      persistence: inMemoryPersistence,
      popupRedirectResolver: browserPopupRedirectResolver,
    });
  }
  _auth.useDeviceLanguage?.();
  // intenta mejorar persistencia asincrónicamente
  void safelyUpgradePersistence(_auth);
} else {
  // En servidor devolvemos un objeto auth mínimo (getAuth) — aunque rara vez usado en server
  _auth = getAuth(app);
}

export const auth = _auth;

/** 👇 Helper existente: asegura persistencia LOCAL antes de flujos que requieran storage */
export async function ensureLocalPersistence() {
  if (typeof window === "undefined") return;
  try {
    await setPersistence(auth, browserLocalPersistence);
  } catch (e) {
    devWarn("[firebase] ensureLocalPersistence failed; using inMemory", e);
    try {
      await setPersistence(auth, inMemoryPersistence);
    } catch {
      // fallback silencioso
    }
  }
}

/* ===================== STORAGE (inicialización segura para cliente) =====================
   - Exportamos `storage` que será `FirebaseStorage | null` (null en SSR).
   - También exportamos `getStorageSafe()` que lanza un error claro si se usa en server.
   - Esto evita que las importaciones de `storage` rompan en SSR y es retrocompatible.
   ================================================================================ */

let _storage: FirebaseStorage | null = null;

if (typeof window !== "undefined") {
  try {
    _storage = getStorage(app);
  } catch (e) {
    devWarn("[firebase] getStorage() falló en cliente", e);
    _storage = null;
  }
} else {
  // En SSR dejamos storage como null; quien lo use debe usar getStorageSafe() o validar
  _storage = null;
}

/**
 * Storage export (puede ser null si estamos en SSR).
 * Uso sugerido en componentes client-side:
 *   import { storage } from "@/lib/firebase/client";
 *   if (!storage) throw new Error("storage no inicializado; usa esto sólo en cliente");
 */
export const storage: FirebaseStorage | null = _storage;

/**
 * Helper que garantiza y retorna storage o lanza un error con mensaje claro.
 * Útil para evitar errores crípticos si alguien intenta usar Storage en SSR.
 */
export function getStorageSafe(): FirebaseStorage {
  if (!_storage) {
    throw new Error(
      "Firebase Storage no está inicializado. Asegúrate de usar `getStorageSafe()` sólo en componentes cliente (browser) y de que `src/lib/firebase/client.ts` corra en el cliente. Si necesitas acceder a Storage desde server, usa Admin SDK o expone una URL pública."
    );
  }
  return _storage;
}

/* Helper debug: permite inspección desde DevTools en desarrollo */
if (typeof window !== "undefined" && process.env.NODE_ENV === "development") {
  (window as any).__firebase = {
    app,
    auth,
    storage,
  };
}
