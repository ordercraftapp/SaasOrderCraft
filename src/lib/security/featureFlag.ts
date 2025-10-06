import * as admin from "firebase-admin";

function ensureAdmin() {
  if (!admin.apps.length) {
    const json = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_JSON;
    if (json) admin.initializeApp({ credential: admin.credential.cert(JSON.parse(json)) });
    else admin.initializeApp({ credential: admin.credential.applicationDefault() });
  }
  return admin.firestore();
}

export async function isAIStudioEnabled() {
  const db = ensureAdmin();
  const snap = await db.doc("system_flags/ai_studio").get();

  // Por defecto: ON si no existe el doc
  if (!snap.exists) return true;

  const data = snap.data() as { enabled?: boolean } | undefined;
  // Si el campo no existe, tratamos como ON; solo es OFF si es false explícito
  return data?.enabled !== false;
}
