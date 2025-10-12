// Client/SSR (firebase web SDK)
import '@/lib/firebase/client';
import { getFirestore, collection, doc, CollectionReference, DocumentReference } from 'firebase/firestore';

/** Subcolección dentro de tenants/{tenantId} */
export function tCol<T = unknown>(colName: string, tenantId: string): CollectionReference<T> {
  const db = getFirestore();
  return collection(db, 'tenants', tenantId, colName) as CollectionReference<T>;
}

export function tDoc<T = unknown>(colName: string, tenantId: string, id: string): DocumentReference<T> {
  const db = getFirestore();
  return doc(db, 'tenants', tenantId, colName, id) as DocumentReference<T>;
}

/** Para collectionGroup cross-tenant, filtrar with where('tenantId','==', tenantId) si guardas tenantId en payload */
