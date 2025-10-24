// src/lib/tax/profile.ts

import {
  getFirestore,
  collection,
  query,
  where,
  limit,
  getDocs,
  doc,
  getDoc,
  setDoc,
  writeBatch,
  serverTimestamp,
  onSnapshot,
  type Unsubscribe,
} from 'firebase/firestore';
import { tCol } from '@/lib/db';

export type OrderType = 'dine-in' | 'delivery' | 'pickup';

export type TaxRateRule = {
  code: string;
  label?: string;
  rateBps: number;                    // 1200 = 12%
  appliesTo?: 'all';
  itemCategoryIn?: string[];
  itemTagIn?: string[];
  excludeItemTagIn?: string[];
  orderTypeIn?: OrderType[];

  // NUEVO: flags Fase C
  zeroRated?: boolean;                // base gravable con tasa 0%
  exempt?: boolean;                   // exento (fuera de base)
};

export type SurchargeRule = {
  code: string;
  label?: string;
  percentBps: number;                 // 1000 = 10%
  applyWhenOrderTypeIn?: OrderType[];
  taxable?: boolean;
  taxCode?: string;                   // qué tasa aplicar al recargo
};

export type DeliveryPolicy = {
  mode: 'as_line' | 'out_of_scope';   // "línea sintética" o fuera del cálculo
  taxable?: boolean;
  taxCode?: string;
};

/** --------- NUEVO: Jurisdicciones y B2B/Factura --------- */
export type JurisdictionRule = {
  code: string;
  match: { country?: string; state?: string; city?: string; zipPrefix?: string };
  ratesOverride?: TaxRateRule[];
  surchargesOverride?: SurchargeRule[];
  deliveryOverride?: DeliveryPolicy;
  pricesIncludeTaxOverride?: boolean;
  roundingOverride?: 'half_up' | 'half_even';
};

export type InvoiceNumberingConfig = {
  enabled: boolean;
  series?: string;        // ej. "A"
  prefix?: string;        // ej. "INV-"
  suffix?: string;        // ej. "-2025"
  padding?: number;       // ej. 8 -> INV-00001234
  resetPolicy?: 'never' | 'yearly' | 'monthly' | 'daily';
};

export type B2BConfig = {
  taxExemptWithTaxId?: boolean;  // default false (GT no exime por NIT automáticamente)
  invoiceNumbering?: InvoiceNumberingConfig;
};
/** -------------------------------------------------------- */

export type TaxProfile = {
  id?: string;
  country: string;
  currency: string;
  pricesIncludeTax: boolean;
  rounding?: 'half_up' | 'half_even';
  rates: TaxRateRule[];
  surcharges?: SurchargeRule[];
  delivery?: DeliveryPolicy;

  /** NUEVO */
  jurisdictions?: JurisdictionRule[];
  b2bConfig?: B2BConfig;
};

/* =========================================================================
   MAPPERS COMUNES
   ========================================================================= */

function mapRates(arr: any[] | undefined): TaxRateRule[] {
  if (!Array.isArray(arr)) return [];
  return arr.map((r: any) => ({
    code: String(r.code),
    label: r.label ? String(r.label) : undefined,
    rateBps: Number(r.rateBps || 0),
    appliesTo: r.appliesTo === 'all' ? 'all' : undefined,
    itemCategoryIn: Array.isArray(r.itemCategoryIn) ? r.itemCategoryIn.map(String) : undefined,
    itemTagIn: Array.isArray(r.itemTagIn) ? r.itemTagIn.map(String) : undefined,
    excludeItemTagIn: Array.isArray(r.excludeItemTagIn) ? r.excludeItemTagIn.map(String) : undefined,
    orderTypeIn: Array.isArray(r.orderTypeIn) ? (r.orderTypeIn as OrderType[]) : undefined,
    zeroRated: Boolean(r.zeroRated ?? false),
    exempt: Boolean(r.exempt ?? false),
  }));
}


function mapSurcharges(arr: any[] | undefined): SurchargeRule[] | undefined {
  if (!Array.isArray(arr)) return undefined;
  return arr.map((s: any) => ({
    code: String(s.code),
    label: s.label ? String(s.label) : undefined,
    percentBps: Number(s.percentBps || 0),
    applyWhenOrderTypeIn: Array.isArray(s.applyWhenOrderTypeIn) ? (s.applyWhenOrderTypeIn as OrderType[]) : undefined,
    taxable: Boolean(s.taxable ?? false),
    taxCode: s.taxCode ? String(s.taxCode) : undefined,
  }));
}

function mapDelivery(d: any | undefined): DeliveryPolicy | undefined {
  if (!d) return undefined;
  return {
    mode: d.mode === 'out_of_scope' ? 'out_of_scope' : 'as_line',
    taxable: Boolean(d.taxable ?? false),
    taxCode: d.taxCode ? String(d.taxCode) : undefined,
  };
}

function mapJurisdictions(arr: any[] | undefined): JurisdictionRule[] | undefined {
  if (!Array.isArray(arr)) return undefined;
  return arr.map((j: any) => ({
    code: String(j.code),
    match: {
      country: j.match?.country ? String(j.match.country) : undefined,
      state: j.match?.state ? String(j.match.state) : undefined,
      city: j.match?.city ? String(j.match.city) : undefined,
      zipPrefix: j.match?.zipPrefix ? String(j.match.zipPrefix) : undefined,
    },
    ratesOverride: mapRates(j.ratesOverride),
    surchargesOverride: mapSurcharges(j.surchargesOverride),
    deliveryOverride: mapDelivery(j.deliveryOverride),
    pricesIncludeTaxOverride: j.pricesIncludeTaxOverride !== undefined ? Boolean(j.pricesIncludeTaxOverride) : undefined,
    roundingOverride:
      j.roundingOverride === 'half_even'
        ? 'half_even'
        : (j.roundingOverride === 'half_up' ? 'half_up' : undefined),
  }));
}

function mapB2B(raw: any | undefined): B2BConfig | undefined {
  if (!raw) return undefined;
  const inv = raw.invoiceNumbering || undefined;
  return {
    taxExemptWithTaxId: Boolean(raw.taxExemptWithTaxId ?? false),
    invoiceNumbering: inv
      ? {
          enabled: Boolean(inv.enabled ?? false),
          series: inv.series ? String(inv.series) : undefined,
          prefix: inv.prefix ? String(inv.prefix) : undefined,
          suffix: inv.suffix ? String(inv.suffix) : undefined,
          padding: Number.isFinite(inv.padding) ? Number(inv.padding) : undefined,
          resetPolicy: ['never', 'yearly', 'monthly', 'daily'].includes(inv.resetPolicy)
            ? inv.resetPolicy
            : undefined,
        }
      : undefined,
  };
}

function mapRawToProfile(raw: any, id?: string): TaxProfile {
  return {
    id,
    country: String(raw?.country || 'GT'),
    currency: String(raw?.currency || 'USD'),
    pricesIncludeTax: Boolean(raw?.pricesIncludeTax ?? true),
    rounding: raw?.rounding === 'half_even' ? 'half_even' : 'half_up',
    rates: mapRates(raw?.rates),
    surcharges: mapSurcharges(raw?.surcharges),
    delivery: mapDelivery(raw?.delivery),
    jurisdictions: mapJurisdictions(raw?.jurisdictions),
    b2bConfig: mapB2B(raw?.b2bConfig),
  };
}

/* =========================================================================
   PUBLIC: PERFIL ACTIVO TENANT-SCOPED
   ========================================================================= */

/** Lee el perfil activo del tenant desde tenants/{tenantId}/taxProfiles/active */
// 👇 NUEVO: perfil activo por tenant (respeta tus reglas)
export async function getActiveTaxProfileForTenant(tenantId: string) {
  const db = getFirestore();
  const ref = doc(tCol('taxProfiles', tenantId), 'active'); // /tenants/{tenantId}/taxProfiles/active
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  const raw = snap.data() as any;
  return { id: snap.id, ...raw };
}


/** Suscripción en tiempo real al perfil activo del tenant. */
export function onActiveTaxProfileSnapshot(
  tenantId: string,
  cb: (profile: TaxProfile | null) => void,
): Unsubscribe {
  const db = getFirestore();
  const ref = doc(db, `tenants/${tenantId}/taxProfiles/active`);
  return onSnapshot(ref, (ds) => {
    if (!ds.exists()) { cb(null); return; }
    cb(mapRawToProfile(ds.data(), ds.id));
  }, () => cb(null));
}

/** Upsert del perfil activo (escribe en tenants/{tenantId}/taxProfiles/active) */
export async function upsertActiveTaxProfileForTenant(
  tenantId: string,
  input: Partial<TaxProfile> & { id?: string }, // id se ignora; siempre escribimos en 'active'
): Promise<void> {
  const db = getFirestore();
  const ref = doc(db, `tenants/${tenantId}/taxProfiles/active`);

  // Leer previo para preservar createdAt
  const prevSnap = await getDoc(ref);
  const prev = prevSnap.exists() ? prevSnap.data() : {};

  // Normalización mínima, respetando tu esquema
  const toStr = (x: any, d = '') => (typeof x === 'string' && x.trim() !== '' ? x : d);
  const toBool = (x: any, d = false) => (typeof x === 'boolean' ? x : !!d);
  const arrStr = (a: any) => (Array.isArray(a) ? a.map(String) : undefined);

  const normalized: any = {
    country: toStr(input.country ?? (prev as any)?.country ?? 'GT'),
    currency: toStr(input.currency ?? (prev as any)?.currency ?? 'USD'),
    pricesIncludeTax: toBool(input.pricesIncludeTax ?? (prev as any)?.pricesIncludeTax ?? true),
    rounding: (input.rounding === 'half_even' || (prev as any)?.rounding === 'half_even') ? 'half_even' : 'half_up',

    rates: Array.isArray(input.rates) ? input.rates.map((r: any) => ({
      code: toStr(r.code),
      label: r.label ? String(r.label) : undefined,
      rateBps: Number(r.rateBps || 0),
      appliesTo: r.appliesTo === 'all' ? 'all' : undefined,
      itemCategoryIn: arrStr(r.itemCategoryIn),
      itemTagIn: arrStr(r.itemTagIn),
      excludeItemTagIn: arrStr(r.excludeItemTagIn),
      orderTypeIn: Array.isArray(r.orderTypeIn) ? r.orderTypeIn as OrderType[] : undefined,
      zeroRated: toBool(r.zeroRated ?? false),
      exempt: toBool(r.exempt ?? false),
    })) : (Array.isArray((prev as any)?.rates) ? (prev as any).rates : []),

    surcharges: Array.isArray(input.surcharges)
      ? input.surcharges.map((s: any) => ({
          code: toStr(s.code),
          label: s.label ? String(s.label) : undefined,
          percentBps: Number(s.percentBps || 0),
          applyWhenOrderTypeIn: Array.isArray(s.applyWhenOrderTypeIn) ? s.applyWhenOrderTypeIn as OrderType[] : undefined,
          taxable: toBool(s.taxable ?? false),
          taxCode: s.taxCode ? String(s.taxCode) : undefined,
        }))
      : (Array.isArray((prev as any)?.surcharges) ? (prev as any).surcharges : undefined),

    delivery: input.delivery
      ? {
          mode: (input.delivery.mode === 'out_of_scope' ? 'out_of_scope' : 'as_line') as 'as_line' | 'out_of_scope',
          taxable: toBool(input.delivery.taxable ?? false),
          taxCode: input.delivery.taxCode ? String(input.delivery.taxCode) : undefined,
        }
      : ((prev as any)?.delivery || undefined),

    // NUEVO: jurisdicciones
    jurisdictions: Array.isArray(input.jurisdictions)
      ? input.jurisdictions.map((j: any) => ({
          code: toStr(j.code),
          match: {
            country: j.match?.country ? String(j.match.country) : undefined,
            state: j.match?.state ? String(j.match.state) : undefined,
            city: j.match?.city ? String(j.match.city) : undefined,
            zipPrefix: j.match?.zipPrefix ? String(j.match.zipPrefix) : undefined,
          },
          ratesOverride: Array.isArray(j.ratesOverride) ? j.ratesOverride.map((r: any) => ({
            code: toStr(r.code),
            label: r.label ? String(r.label) : undefined,
            rateBps: Number(r.rateBps || 0),
            appliesTo: r.appliesTo === 'all' ? 'all' : undefined,
            itemCategoryIn: arrStr(r.itemCategoryIn),
            itemTagIn: arrStr(r.itemTagIn),
            excludeItemTagIn: arrStr(r.excludeItemTagIn),
            orderTypeIn: Array.isArray(r.orderTypeIn) ? r.orderTypeIn as OrderType[] : undefined,
            zeroRated: toBool(r.zeroRated ?? false),
            exempt: toBool(r.exempt ?? false),
          })) : undefined,
          surchargesOverride: Array.isArray(j.surchargesOverride) ? j.surchargesOverride.map((s: any) => ({
            code: toStr(s.code),
            label: s.label ? String(s.label) : undefined,
            percentBps: Number(s.percentBps || 0),
            applyWhenOrderTypeIn: Array.isArray(s.applyWhenOrderTypeIn) ? s.applyWhenOrderTypeIn as OrderType[] : undefined,
            taxable: toBool(s.taxable ?? false),
            taxCode: s.taxCode ? String(s.taxCode) : undefined,
          })) : undefined,
          deliveryOverride: j.deliveryOverride
            ? {
                mode: (j.deliveryOverride.mode === 'out_of_scope' ? 'out_of_scope' : 'as_line') as 'as_line' | 'out_of_scope',
                taxable: toBool(j.deliveryOverride.taxable ?? false),
                taxCode: j.deliveryOverride.taxCode ? String(j.deliveryOverride.taxCode) : undefined,
              }
            : undefined,
          pricesIncludeTaxOverride: (j.pricesIncludeTaxOverride !== undefined) ? toBool(j.pricesIncludeTaxOverride) : undefined,
          roundingOverride: (j.roundingOverride === 'half_even' ? 'half_even' : (j.roundingOverride === 'half_up' ? 'half_up' : undefined)),
        }))
      : ((prev as any)?.jurisdictions || undefined),

    // NUEVO: B2B
    b2bConfig: input.b2bConfig
      ? {
          taxExemptWithTaxId: toBool(input.b2bConfig.taxExemptWithTaxId ?? false),
          invoiceNumbering: input.b2bConfig.invoiceNumbering
            ? {
                enabled: toBool(input.b2bConfig.invoiceNumbering.enabled ?? false),
                series: input.b2bConfig.invoiceNumbering.series ? String(input.b2bConfig.invoiceNumbering.series) : undefined,
                prefix: input.b2bConfig.invoiceNumbering.prefix ? String(input.b2bConfig.invoiceNumbering.prefix) : undefined,
                suffix: input.b2bConfig.invoiceNumbering.suffix ? String(input.b2bConfig.invoiceNumbering.suffix) : undefined,
                padding: Number.isFinite(input.b2bConfig.invoiceNumbering.padding) ? Number(input.b2bConfig.invoiceNumbering.padding) : undefined,
                resetPolicy: ['never', 'yearly', 'monthly', 'daily'].includes(input.b2bConfig.invoiceNumbering.resetPolicy as any)
                  ? input.b2bConfig.invoiceNumbering.resetPolicy
                  : undefined,
              }
            : undefined,
        }
      : ((prev as any)?.b2bConfig || undefined),
  };

  await setDoc(
    ref,
    {
      ...normalized,
      active: true,
      tenantId,
      updatedAt: serverTimestamp(),
      createdAt: (prev as any)?.createdAt ?? serverTimestamp(), // preserva createdAt si existía
    },
    { merge: true }
  );
}

/** Helper rápido: devuelve solo la numeración de facturas del tenant (o null). */
export async function getInvoiceNumberingConfigForTenant(
  tenantId: string
): Promise<InvoiceNumberingConfig | null> {
  const p = await getActiveTaxProfileForTenant(tenantId);
  return p?.b2bConfig?.invoiceNumbering ?? null;
}

/* =========================================================================
   PERFIL EFECTIVO POR DIRECCIÓN (jurisdicción)
   ========================================================================= */

export function getEffectiveProfileForAddress(
  profile: TaxProfile,
  addr?: { country?: string; state?: string; city?: string; zip?: string } | null
): TaxProfile {
  if (!profile?.jurisdictions?.length || !addr) return profile;

  const A = (s?: string) => (s ?? '').toString().trim().toLowerCase();

  const matches = profile.jurisdictions.filter(j => {
    const m = j.match || {};
    if (m.country && A(m.country) !== A(addr.country)) return false;
    if (m.state && A(m.state) !== A((addr as any).state)) return false;
    if (m.city && A(m.city) !== A(addr.city)) return false;
    if (m.zipPrefix && !A(addr.zip).startsWith(A(m.zipPrefix))) return false;
    return true;
  });

  if (!matches.length) return profile;

  // Prioridad: zipPrefix > city > state > country
  const score = (j: JurisdictionRule) =>
    j.match.zipPrefix ? 4 : j.match.city ? 3 : (j.match.state ? 2 : (j.match.country ? 1 : 0));
  const best = matches.slice().sort((a, b) => score(b) - score(a))[0];

  return {
    ...profile,
    pricesIncludeTax: (best.pricesIncludeTaxOverride ?? profile.pricesIncludeTax),
    rounding: (best.roundingOverride ?? profile.rounding),
    rates: best.ratesOverride?.length ? best.ratesOverride : profile.rates,
    surcharges: best.surchargesOverride?.length ? best.surchargesOverride : profile.surcharges,
    delivery: best.deliveryOverride ? best.deliveryOverride : profile.delivery,
  };
}

/* =========================================================================
   LEGACY (GLOBAL) — MANTENIDO PARA COMPATIBILIDAD TEMPORAL
   =========================================================================
   ⚠️ DEPRECADO: migra a las funciones *ForTenant*. 
   Estas funciones siguen leyendo/escribiendo en la colección global `taxProfiles`
   para no romper módulos antiguos mientras migras.
   ========================================================================= */

export async function getActiveTaxProfile(): Promise<TaxProfile | null> {
  const db = getFirestore();
  const qRef = query(collection(db, 'taxProfiles'), where('active', '==', true), limit(1));
  const snap = await getDocs(qRef);
  const docSnap = snap.docs[0];
  if (!docSnap) return null;
  return mapRawToProfile(docSnap.data(), docSnap.id);
}

/**
 * Crea/actualiza un perfil global y lo marca como activo (colección raíz).
 * - Si viene `input.id`, actualiza ese doc.
 * - Si NO viene `id`, usa el doc fijo `taxProfiles/active`.
 * - Desactiva otros perfiles con `active==true`.
 * ⚠️ DEPRECADO: usa upsertActiveTaxProfileForTenant(tenantId, input).
 */
export async function upsertActiveTaxProfile(input: Partial<TaxProfile> & { id?: string }): Promise<void> {
  const db = getFirestore();
  const targetId = input.id || 'active';
  const ref = doc(db, 'taxProfiles', targetId);

  // Leer previo para conservar createdAt y mezclar sin perder campos
  const prevSnap = await getDoc(ref);
  const prev = prevSnap.exists() ? prevSnap.data() : {};

  // Sanitizar/normalizar lo que guardamos
  const toStr = (x: any, d = '') => (typeof x === 'string' && x.trim() !== '' ? x : d);
  const toBool = (x: any, d = false) => (typeof x === 'boolean' ? x : !!d);
  const arrStr = (a: any) => (Array.isArray(a) ? a.map(String) : undefined);

  // Normalización mínima (respetando tu esquema)
  const normalized: any = {
    country: toStr(input.country ?? (prev as any)?.country ?? 'GT'),
    currency: toStr(input.currency ?? (prev as any)?.currency ?? 'USD'),
    pricesIncludeTax: toBool(input.pricesIncludeTax ?? (prev as any)?.pricesIncludeTax ?? true),
    rounding: (input.rounding === 'half_even' || (prev as any)?.rounding === 'half_even') ? 'half_even' : 'half_up',

    rates: Array.isArray(input.rates) ? input.rates.map((r: any) => ({
      code: toStr(r.code),
      label: r.label ? String(r.label) : undefined,
      rateBps: Number(r.rateBps || 0),
      appliesTo: r.appliesTo === 'all' ? 'all' : undefined,
      itemCategoryIn: arrStr(r.itemCategoryIn),
      itemTagIn: arrStr(r.itemTagIn),
      excludeItemTagIn: arrStr(r.excludeItemTagIn),
      orderTypeIn: Array.isArray(r.orderTypeIn) ? r.orderTypeIn as OrderType[] : undefined,
      zeroRated: toBool(r.zeroRated ?? false),
      exempt: toBool(r.exempt ?? false),
    })) : (Array.isArray((prev as any)?.rates) ? (prev as any).rates : []),

    surcharges: Array.isArray(input.surcharges)
      ? input.surcharges.map((s: any) => ({
          code: toStr(s.code),
          label: s.label ? String(s.label) : undefined,
          percentBps: Number(s.percentBps || 0),
          applyWhenOrderTypeIn: Array.isArray(s.applyWhenOrderTypeIn) ? s.applyWhenOrderTypeIn as OrderType[] : undefined,
          taxable: toBool(s.taxable ?? false),
          taxCode: s.taxCode ? String(s.taxCode) : undefined,
        }))
      : (Array.isArray((prev as any)?.surcharges) ? (prev as any).surcharges : undefined),

    delivery: input.delivery
      ? {
          mode: (input.delivery.mode === 'out_of_scope' ? 'out_of_scope' : 'as_line') as 'as_line' | 'out_of_scope',
          taxable: toBool(input.delivery.taxable ?? false),
          taxCode: input.delivery.taxCode ? String(input.delivery.taxCode) : undefined,
        }
      : ((prev as any)?.delivery || undefined),

    jurisdictions: Array.isArray((input as any).jurisdictions)
      ? mapJurisdictions((input as any).jurisdictions)
      : ((prev as any)?.jurisdictions || undefined),

    b2bConfig: input.b2bConfig
      ? mapB2B(input.b2bConfig)
      : ((prev as any)?.b2bConfig || undefined),
  };

  // Guardar/mergear y marcar activo
  await setDoc(
    ref,
    {
      ...normalized,
      active: true,
      updatedAt: serverTimestamp(),
      createdAt: prevSnap.exists() ? (prev as any)?.createdAt ?? serverTimestamp() : serverTimestamp(),
    },
    { merge: true }
  );

  // Desactivar otros activos (si existen)
  const activeSnap = await getDocs(query(collection(db, 'taxProfiles'), where('active', '==', true)));
  const batch = writeBatch(db);
  activeSnap.docs.forEach((d) => {
    if (d.id !== targetId) {
      batch.set(d.ref, { active: false, updatedAt: serverTimestamp() }, { merge: true });
    }
  });
  await batch.commit();
}
