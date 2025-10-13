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
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET!,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID!,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
};

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

let _auth: Auth;

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
  // inMemory ya activo
}

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
  void safelyUpgradePersistence(_auth);
} else {
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
      // fallback
    }
  }
}
