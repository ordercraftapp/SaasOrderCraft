import * as admin from 'firebase-admin';

export function ensureAdmin() {
  if (!admin.apps.length) {
    const json = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_JSON;
    if (json) {
      admin.initializeApp({ credential: admin.credential.cert(JSON.parse(json)) });
    } else {
      admin.initializeApp({ credential: admin.credential.applicationDefault() });
    }
  }
  return admin;
}

export function tColAdmin<T = admin.firestore.DocumentData>(colName: string, tenantId: string) {
  const db = ensureAdmin().firestore();
  return db.collection(`tenants/${tenantId}/${colName}`) as admin.firestore.CollectionReference<T>;
}

export function tDocAdmin<T = admin.firestore.DocumentData>(colName: string, tenantId: string, id: string) {
  const db = ensureAdmin().firestore();
  return db.doc(`tenants/${tenantId}/${colName}/${id}`) as admin.firestore.DocumentReference<T>;
}
