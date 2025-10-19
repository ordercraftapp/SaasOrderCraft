import { getFirestore, doc, getDoc, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import "@/lib/firebase/client";

export type TenantGeneralSettings = {
  currency: string;        // ISO: "USD", "GTQ", "MXN", "EUR", etc.
  currencyLocale: string;  // "es-GT", "en-US", etc.
  language?: "es" | "en" | "pt" | "fr";
  updatedAt?: any;
  createdAt?: any;
};

// 🔐 Siempre requerimos tenantId explícito para evitar "default"
export function generalSettingsRef(tenantId: string, db = getFirestore()) {
  if (!tenantId) throw new Error("generalSettingsRef: tenantId is required");
  return doc(db, "tenants", tenantId, "settings", "general");
}

export async function readGeneralSettings(tenantId: string): Promise<TenantGeneralSettings> {
  const ref = generalSettingsRef(tenantId);
  const snap = await getDoc(ref);
  if (snap.exists()) {
    const data = (snap.data() || {}) as TenantGeneralSettings;
    return {
      currency: data.currency || "USD",
      currencyLocale: data.currencyLocale || "en-US",
      language: (data.language as any) || "es",
      updatedAt: data.updatedAt,
      createdAt: data.createdAt,
    };
  }
  // Si no existe, inicializamos con defaults
  const defaults: TenantGeneralSettings = {
    currency: "USD",
    currencyLocale: "en-US",
    language: "es",
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
  await setDoc(ref, defaults, { merge: true });
  return defaults;
}

export async function writeGeneralSettings(
  tenantId: string,
  partial: Partial<TenantGeneralSettings>
) {
  const ref = generalSettingsRef(tenantId);
  const payload = {
    ...partial,
    updatedAt: serverTimestamp(),
  };
  // Si no existe, setDoc con defaults + merge
  try {
    await updateDoc(ref, payload as any);
  } catch {
    await setDoc(ref, { ...payload, createdAt: serverTimestamp() }, { merge: true });
  }
}

/** Factory para usar en componentes/hook con el tenantId ya “inyectado” */
export function makeSettingsIO(tenantId: string | null | undefined) {
  const tid = tenantId || "";
  return {
    readGeneralSettings: () => readGeneralSettings(tid),
    writeGeneralSettings: (partial: Partial<TenantGeneralSettings>) =>
      writeGeneralSettings(tid, partial),
  };
}
