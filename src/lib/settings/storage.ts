// src/lib/settings/storage.ts
import { getFirestore, doc, getDoc, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import "@/lib/firebase/client";

export type TenantGeneralSettings = {
  currency: string;        // ISO: "USD", "GTQ", "MXN", "EUR", etc.
  currencyLocale: string;  // "es-GT", "en-US", etc.
  updatedAt?: any;
  createdAt?: any;
};

// ⚙️ Si no usas multi-tenant aún, usa "default". Luego podrás conectar dominio/subdominio o custom claims.
export function resolveTenantId(): string {
  try {
    // TODO (futuro): leer de custom claims o subdominio
    return process.env.NEXT_PUBLIC_TENANT_ID || "default";
  } catch {
    return "default";
  }
}

export function generalSettingsRef(db = getFirestore()) {
  const tenantId = resolveTenantId();
  return doc(db, "tenants", tenantId, "settings", "general");
}

export async function readGeneralSettings(): Promise<TenantGeneralSettings> {
  const ref = generalSettingsRef();
  const snap = await getDoc(ref);
  if (snap.exists()) {
    const data = (snap.data() || {}) as TenantGeneralSettings;
    return {
      currency: data.currency || "USD",
      currencyLocale: data.currencyLocale || "en-US",
      updatedAt: data.updatedAt,
      createdAt: data.createdAt,
    };
  }
  // Si no existe, creamos defaults
  const defaults: TenantGeneralSettings = {
    currency: "USD",
    currencyLocale: "en-US",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  await setDoc(ref, defaults, { merge: true });
  return defaults;
}

export async function writeGeneralSettings(partial: Partial<TenantGeneralSettings>) {
  const ref = generalSettingsRef();
  const payload = {
    ...partial,
    updatedAt: serverTimestamp(),
  };
  // Si el doc no existe, setDoc con defaults + merge
  try {
    await updateDoc(ref, payload as any);
  } catch {
    await setDoc(ref, { ...payload, createdAt: serverTimestamp() }, { merge: true });
  }
}
