// src/lib/firebase/admin.ts
import "server-only";
import * as admin from "firebase-admin";

/**
 * Emuladores (opcional):
 *  - FIREBASE_EMULATORS=1 o NEXT_PUBLIC_FIREBASE_EMULATORS=1
 */
const USE_EMULATORS =
  process.env.FIREBASE_EMULATORS === "1" ||
  process.env.NEXT_PUBLIC_FIREBASE_EMULATORS === "1";

// Define hosts de emuladores **antes** de inicializar Admin SDK
if (USE_EMULATORS) {
  if (!process.env.FIRESTORE_EMULATOR_HOST) {
    process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080"; // Firestore → "host:port"
  }
  if (!process.env.FIREBASE_AUTH_EMULATOR_HOST) {
    process.env.FIREBASE_AUTH_EMULATOR_HOST = "http://localhost:9099"; // Auth → "http://host:port"
  }
  // Si usas emulador, asegúrate de tener un projectId consistente:
  process.env.FIREBASE_PROJECT_ID =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.GCLOUD_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT ||
    "demo-project";
}

/**
 * Construye credencial de Admin desde envs disponibles.
 * Orden:
 *  1) FIREBASE_SERVICE_ACCOUNT_JSON (JSON)
 *  2) variables sueltas (PROJECT_ID, CLIENT_EMAIL, PRIVATE_KEY / PRIVATE_KEY_BASE64)
 *  3) (evitamos) ADC en Vercel; tiramos error claro si falta
 */
function getAdminCredential(): admin.credential.Credential {
  // 1) JSON completo (service account)
  const json = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (json) {
    try {
      const parsed = JSON.parse(json);
      if (!parsed.project_id || !parsed.client_email || !parsed.private_key) {
        console.warn(
          "[firebase-admin] FIREBASE_SERVICE_ACCOUNT_JSON presente pero incompleto (falta project_id/client_email/private_key)"
        );
      } else {
        return admin.credential.cert(parsed);
      }
    } catch {
      console.warn(
        "[firebase-admin] FIREBASE_SERVICE_ACCOUNT_JSON inválido; intentando con variables sueltas…"
      );
    }
  }

  // 2) Variables sueltas
  const projectId =
    process.env.FIREBASE_PROJECT_ID ||
    process.env.GCLOUD_PROJECT ||
    process.env.GOOGLE_CLOUD_PROJECT;

  const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;

  // soporta clave en texto o base64
  let privateKeyRaw = process.env.FIREBASE_PRIVATE_KEY;
  const privateKeyB64 = process.env.FIREBASE_PRIVATE_KEY_BASE64;

  if (!privateKeyRaw && privateKeyB64) {
    try {
      privateKeyRaw = Buffer.from(privateKeyB64, "base64").toString("utf8");
    } catch {
      console.warn(
        "[firebase-admin] FIREBASE_PRIVATE_KEY_BASE64 no se pudo decodificar; intentando PRIVATE_KEY plano…"
      );
    }
  }

  if (projectId && clientEmail && privateKeyRaw) {
    const privateKey = privateKeyRaw.replace(/\\n/g, "\n");
    if (!privateKey.includes("BEGIN PRIVATE KEY")) {
      console.warn(
        "[firebase-admin] FIREBASE_PRIVATE_KEY parece inválida (no contiene BEGIN PRIVATE KEY). Revisa comillas y \\n."
      );
    }
    return admin.credential.cert({
      projectId,
      clientEmail,
      privateKey,
    } as admin.ServiceAccount);
  }

  // 3) ADC: en Vercel normalmente NO existe ADC → mejor ser explícitos
  const onVercel = Boolean(process.env.VERCEL);
  if (!onVercel) {
    // Local: intentar ADC
    try {
      return admin.credential.applicationDefault();
    } catch {
      /* ignore */
    }
  }

  // Si llegamos aquí, faltan credenciales
  const hint =
    "Configura FIREBASE_SERVICE_ACCOUNT_JSON (JSON completo) o FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY (o *_BASE64).";
  throw new Error(
    `[firebase-admin] Credenciales no encontradas. ${hint}`
  );
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
      // databaseURL (si usas RTDB), storageBucket (si usas Storage) pueden ir aquí
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
} catch {
  /* no-op */
}

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

/** Helpers */
export function ensureAdminApp() {
  return adminApp;
}

export function getAdminAuth() {
  return adminAuth;
}

export function getAdminDB() {
  return db;
}

/** ========= Helpers multi-tenant ========= */
// tenancyUpdate: colecciones bajo tenants/{tenantId}/<subcol>
export function tColAdmin(subcol: string, tenantId: string) {           // tenancyUpdate (nuevo)
  return db.collection("tenants").doc(tenantId).collection(subcol);
}

export function tDocAdmin(subcol: string, tenantId: string, id: string) { // tenancyUpdate (nuevo)
  return tColAdmin(subcol, tenantId).doc(id);
}
