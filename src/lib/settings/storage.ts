// src/lib/settings/storage.ts
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

  // 🧪 DEBUG (quitar luego): log del path
  console.debug("[settings] ref path:", `tenants/${tenantId}/settings/general`);

  return doc(db, "tenants", tenantId, "settings", "general");
}

export async function readGeneralSettings(tenantId: string): Promise<TenantGeneralSettings> {
  const ref = generalSettingsRef(tenantId);

  // 🧪 DEBUG (quitar luego): antes de leer
  console.debug("[settings] READ from:", (ref as any).path);

  const snap = await getDoc(ref);

  // 🧪 DEBUG (quitar luego): resultado de la lectura
  console.debug("[settings] READ exists?:", snap.exists());

  if (snap.exists()) {
    const data = (snap.data() || {}) as TenantGeneralSettings;

    // 🧪 DEBUG (quitar luego): datos leídos
    console.debug("[settings] READ data:", data);

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

  // 🧪 DEBUG (quitar luego): escribiendo defaults
  console.debug("[settings] WRITE defaults to:", (ref as any).path, "payload:", defaults);

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

  // 🧪 DEBUG (quitar luego): intento de update con payload
  console.debug("[settings] UPDATE at:", (ref as any).path, "payload:", payload);

  // Si no existe, setDoc con defaults + merge
  try {
    await updateDoc(ref, payload as any);
  } catch (e) {
    // 🧪 DEBUG (quitar luego): update falló, hacemos set con merge
    console.debug("[settings] UPDATE failed, SET with merge. Error:", e);

    await setDoc(ref, { ...payload, createdAt: serverTimestamp() }, { merge: true });
  }
}

/** Factory para usar en componentes/hook con el tenantId ya “inyectado” */
export function makeSettingsIO(tenantId: string | null | undefined) {
  const tid = tenantId || "";

  // 🧪 DEBUG (quitar luego): tenantId que se inyectará
  console.debug("[settings] makeSettingsIO tenantId:", tid);

  return {
    readGeneralSettings: () => readGeneralSettings(tid),
    writeGeneralSettings: (partial: Partial<TenantGeneralSettings>) =>
      writeGeneralSettings(tid, partial),
  };
}
