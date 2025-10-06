// src/lib/firebase/admin.ts
import "server-only";
import * as admin from 'firebase-admin';

/**
 * Opcional: usa emuladores si está activado por env.
 * FIREBASE_EMULATORS=1 o NEXT_PUBLIC_FIREBASE_EMULATORS=1
 */
const USE_EMULATORS =
  process.env.FIREBASE_EMULATORS === '1' ||
  process.env.NEXT_PUBLIC_FIREBASE_EMULATORS === '1';

// Define hosts de emuladores **antes** de inicializar Admin SDK
if (USE_EMULATORS) {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    // Firestore -> "host:port"
    process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
  }
  if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    // Auth -> "http://host:port"
    process.env.FIREBASE_AUTH_EMULATOR_HOST = 'http://localhost:9099';
  }
}

/** Construye credencial de Admin desde envs disponibles */
function getAdminCredential(): admin.credential.Credential {
  // 1) JSON completo (service account) en una sola variable
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (json) {
    try {
      const parsed = JSON.parse(json);
      return admin.credential.cert(parsed);
    } catch {
      console.warn(
        '[firebase-admin] FIREBASE_SERVICE_ACCOUNT_JSON inválido; se intentará con variables sueltas o ADC.'
      );
    }
  }

  // 2) Variables sueltas típicas
  const projectId = process.env.FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
  const privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY;

  if (projectId && clientEmail && privateKeyRaw) {
    const privateKey = privateKeyRaw.replace(/\\n/g, '\n');
    return admin.credential.cert({
      projectId,
      clientEmail,
      privateKey,
    } as admin.ServiceAccount);
  }

  // 3) Application Default Credentials (ADC)
  return admin.credential.applicationDefault();
}

/** Inicialización única (evita re-inicializar en dev/HMR) */
declare global {
  // eslint-disable-next-line no-var
  var __FIREBASE_ADMIN_APP__: admin.app.App | undefined;
}

let adminApp: admin.app.App;
if (!global.__FIREBASE_ADMIN_APP__) {
  if (!admin.apps.length) {
    adminApp = admin.initializeApp({
      credential: getAdminCredential(),
    });
  } else {
    adminApp = admin.app();
  }
  global.__FIREBASE_ADMIN_APP__ = adminApp;
} else {
  adminApp = global.__FIREBASE_ADMIN_APP__;
}

/** Instancias reutilizables (singleton) */
const adminAuth = admin.auth(adminApp);
const db = admin.firestore(adminApp);

// Ajuste recomendado: ignorar undefined en writes
try {
  // @ts-ignore (según versión)
  db.settings?.({ ignoreUndefinedProperties: true });
} catch { /* no-op */ }

/** Exports principales */
export { admin };
export { adminApp };
export { adminAuth };
export { db };
export const adminDb = db;

/** Exports de conveniencia */
export const Timestamp = admin.firestore.Timestamp;
export const FieldValue = admin.firestore.FieldValue;
export const serverTimestamp = () => admin.firestore.FieldValue.serverTimestamp();

/** Helpers solicitados (mínimo cambio) */
export function ensureAdminApp() {
  return adminApp;
}

export function getAdminAuth() {
  return adminAuth;
}

export function getAdminDB() {
  return db;
}
