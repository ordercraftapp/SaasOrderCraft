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
} from 'firebase/firestore';

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

export async function getActiveTaxProfile(): Promise<TaxProfile | null> {
  const db = getFirestore();
  const qRef = query(collection(db, 'taxProfiles'), where('active', '==', true), limit(1));
  const snap = await getDocs(qRef);
  const docSnap = snap.docs[0];
  if (!docSnap) return null;
  const raw = docSnap.data() as any;

  const profile: TaxProfile = {
    id: docSnap.id,
    country: String(raw.country || 'GT'),
    currency: String(raw.currency || 'USD'),
    pricesIncludeTax: Boolean(raw.pricesIncludeTax ?? true),
    rounding: (raw.rounding === 'half_even' ? 'half_even' : 'half_up'),
    rates: Array.isArray(raw.rates) ? raw.rates.map((r: any) => ({
      code: String(r.code),
      label: r.label ? String(r.label) : undefined,
      rateBps: Number(r.rateBps || 0),
      appliesTo: r.appliesTo === 'all' ? 'all' : undefined,
      itemCategoryIn: Array.isArray(r.itemCategoryIn) ? r.itemCategoryIn.map(String) : undefined,
      itemTagIn: Array.isArray(r.itemTagIn) ? r.itemTagIn.map(String) : undefined,
      excludeItemTagIn: Array.isArray(r.excludeItemTagIn) ? r.excludeItemTagIn.map(String) : undefined,
      orderTypeIn: Array.isArray(r.orderTypeIn) ? r.orderTypeIn as OrderType[] : undefined,

      // NUEVO: flags
      zeroRated: Boolean(r.zeroRated ?? false),
      exempt: Boolean(r.exempt ?? false),
    })) : [],
    surcharges: Array.isArray(raw.surcharges) ? raw.surcharges.map((s: any) => ({
      code: String(s.code),
      label: s.label ? String(s.label) : undefined,
      percentBps: Number(s.percentBps || 0),
      applyWhenOrderTypeIn: Array.isArray(s.applyWhenOrderTypeIn) ? s.applyWhenOrderTypeIn as OrderType[] : undefined,
      taxable: Boolean(s.taxable ?? false),
      taxCode: s.taxCode ? String(s.taxCode) : undefined,
    })) : [],
    delivery: raw.delivery ? {
      mode: (raw.delivery.mode === 'out_of_scope' ? 'out_of_scope' : 'as_line'),
      taxable: Boolean(raw.delivery.taxable ?? false),
      taxCode: raw.delivery.taxCode ? String(raw.delivery.taxCode) : undefined,
    } : undefined,

    /** NUEVO: mapeo de jurisdicciones y B2B */
    jurisdictions: Array.isArray(raw.jurisdictions) ? raw.jurisdictions.map((j: any) => ({
      code: String(j.code),
      match: {
        country: j.match?.country ? String(j.match.country) : undefined,
        state: j.match?.state ? String(j.match.state) : undefined,
        city: j.match?.city ? String(j.match.city) : undefined,
        zipPrefix: j.match?.zipPrefix ? String(j.match.zipPrefix) : undefined,
      },
      ratesOverride: Array.isArray(j.ratesOverride) ? j.ratesOverride.map((r: any) => ({
        code: String(r.code),
        label: r.label ? String(r.label) : undefined,
        rateBps: Number(r.rateBps || 0),
        appliesTo: r.appliesTo === 'all' ? 'all' : undefined,
        itemCategoryIn: Array.isArray(r.itemCategoryIn) ? r.itemCategoryIn.map(String) : undefined,
        itemTagIn: Array.isArray(r.itemTagIn) ? r.itemTagIn.map(String) : undefined,
        excludeItemTagIn: Array.isArray(r.excludeItemTagIn) ? r.excludeItemTagIn.map(String) : undefined,
        orderTypeIn: Array.isArray(r.orderTypeIn) ? r.orderTypeIn as OrderType[] : undefined,

        // NUEVO: flags
        zeroRated: Boolean(r.zeroRated ?? false),
        exempt: Boolean(r.exempt ?? false),
      })) : undefined,
      surchargesOverride: Array.isArray(j.surchargesOverride) ? j.surchargesOverride.map((s: any) => ({
        code: String(s.code),
        label: s.label ? String(s.label) : undefined,
        percentBps: Number(s.percentBps || 0),
        applyWhenOrderTypeIn: Array.isArray(s.applyWhenOrderTypeIn) ? s.applyWhenOrderTypeIn as OrderType[] : undefined,
        taxable: Boolean(s.taxable ?? false),
        taxCode: s.taxCode ? String(s.taxCode) : undefined,
      })) : undefined,
      deliveryOverride: j.deliveryOverride ? {
        mode: (j.deliveryOverride.mode === 'out_of_scope' ? 'out_of_scope' : 'as_line'),
        taxable: Boolean(j.deliveryOverride.taxable ?? false),
        taxCode: j.deliveryOverride.taxCode ? String(j.deliveryOverride.taxCode) : undefined,
      } : undefined,
      pricesIncludeTaxOverride: (j.pricesIncludeTaxOverride !== undefined) ? Boolean(j.pricesIncludeTaxOverride) : undefined,
      roundingOverride: (j.roundingOverride === 'half_even' ? 'half_even' : (j.roundingOverride === 'half_up' ? 'half_up' : undefined)),
    })) : undefined,

    b2bConfig: raw.b2bConfig ? {
      taxExemptWithTaxId: Boolean(raw.b2bConfig.taxExemptWithTaxId ?? false),
      invoiceNumbering: raw.b2bConfig.invoiceNumbering ? {
        enabled: Boolean(raw.b2bConfig.invoiceNumbering.enabled ?? false),
        series: raw.b2bConfig.invoiceNumbering.series ? String(raw.b2bConfig.invoiceNumbering.series) : undefined,
        prefix: raw.b2bConfig.invoiceNumbering.prefix ? String(raw.b2bConfig.invoiceNumbering.prefix) : undefined,
        suffix: raw.b2bConfig.invoiceNumbering.suffix ? String(raw.b2bConfig.invoiceNumbering.suffix) : undefined,
        padding: Number.isFinite(raw.b2bConfig.invoiceNumbering.padding) ? Number(raw.b2bConfig.invoiceNumbering.padding) : undefined,
        resetPolicy: ['never','yearly','monthly','daily'].includes(raw.b2bConfig.invoiceNumbering.resetPolicy) ? raw.b2bConfig.invoiceNumbering.resetPolicy : undefined,
      } : undefined,
    } : undefined,
  };

  return profile;
}

/** --------- NUEVO: perfil efectivo por dirección (jurisdicción) --------- */
export function getEffectiveProfileForAddress(
  profile: TaxProfile,
  addr?: { country?: string; state?: string; city?: string; zip?: string } | null
): TaxProfile {
  if (!profile?.jurisdictions?.length || !addr) return profile;

  const A = (s?: string) => (s ?? '').toString().trim().toLowerCase();

  const matches = profile.jurisdictions.filter(j => {
    const m = j.match || {};
    if (m.country && A(m.country) !== A(addr.country)) return false;
    if (m.state && A(m.state) !== A((addr as any).state)) return false;  // por si agregas state en el futuro
    if (m.city && A(m.city) !== A(addr.city)) return false;
    if (m.zipPrefix && !A(addr.zip).startsWith(A(m.zipPrefix))) return false;
    return true;
  });

  if (!matches.length) return profile;

  // Prioridad: zipPrefix > city > state > country
  const score = (j: JurisdictionRule) => (j.match.zipPrefix ? 4 : j.match.city ? 3 : (j.match.state ? 2 : (j.match.country ? 1 : 0)));
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
/** ---------------------------------------------------------------------- */

/**
 * Crea/actualiza un perfil y lo marca como activo.
 * - Si viene `input.id`, actualiza ese doc.
 * - Si NO viene `id`, usa el doc fijo `taxProfiles/active`.
 * - Desactiva otros perfiles con `active==true`.
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

      // NUEVO
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
  };

  // NUEVO: normalizar y persistir jurisdicciones si vienen
  if (Array.isArray(input.jurisdictions)) {
    normalized.jurisdictions = input.jurisdictions.map((j: any) => ({
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

        // NUEVO
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
    }));
  }

  // NUEVO: normalizar y persistir config B2B si viene
  if (input.b2bConfig) {
    normalized.b2bConfig = {
      taxExemptWithTaxId: toBool(input.b2bConfig.taxExemptWithTaxId ?? false),
      invoiceNumbering: input.b2bConfig.invoiceNumbering ? {
        enabled: toBool(input.b2bConfig.invoiceNumbering.enabled ?? false),
        series: input.b2bConfig.invoiceNumbering.series ? String(input.b2bConfig.invoiceNumbering.series) : undefined,
        prefix: input.b2bConfig.invoiceNumbering.prefix ? String(input.b2bConfig.invoiceNumbering.prefix) : undefined,
        suffix: input.b2bConfig.invoiceNumbering.suffix ? String(input.b2bConfig.invoiceNumbering.suffix) : undefined,
        padding: Number.isFinite(input.b2bConfig.invoiceNumbering.padding) ? Number(input.b2bConfig.invoiceNumbering.padding) : undefined,
        resetPolicy: ['never','yearly','monthly','daily'].includes(input.b2bConfig.invoiceNumbering.resetPolicy as any)
          ? input.b2bConfig.invoiceNumbering.resetPolicy
          : undefined,
      } : undefined,
    };
  }

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
