// /lib/tax/engine.ts

// NUEVO: importar resolver de perfil efectivo
import type { OrderType, TaxRateRule, TaxProfile } from '@/lib/tax/profile';
import { getEffectiveProfileForAddress } from '@/lib/tax/profile';

type DraftLine = {
  lineId: string;
  quantity: number;
  unitPriceCents: number;
  addonsCents?: number;
  optionsDeltaCents?: number;
  lineTotalCents?: number;
  taxExempt?: boolean;
  category?: string;
  tags?: string[];
  code?: string; // e.g. 'delivery_fee'
};

type AddressInfo = { line1?: string; city?: string; country?: string; zip?: string; notes?: string };

export type TaxDraftInput = {
  currency: string;
  // aceptamos 'dine-in' (perfil) y 'dine_in' (UI) — normalizamos abajo
  orderType: OrderType | 'dine_in';
  lines: DraftLine[];
  customer?: { taxId?: string | null; name?: string; taxExempt?: boolean };
  deliveryFeeCents?: number;           // si viene y el perfil pide as_line, se genera una línea sintética
  deliveryAddressInfo?: AddressInfo | null; // NUEVO: para jurisdicción por dirección
};

export type TaxSnapshot = {
  currency: string;
  orderType: OrderType;
  summaryByRate: Array<{ code: string; label?: string; rateBps: number; baseCents: number; taxCents: number }>;
  // NUEVO: sumarios adicionales
  summaryZeroRated?: Array<{ code: string; baseCents: number }>;
  summaryExempt?: Array<{ code: string; baseCents: number }>;
  surcharges?: Array<{ code: string; label?: string; baseCents: number; taxCents: number }>;
  totals: { subTotalCents: number; taxCents: number; grandTotalCents: number };
  customer?: { taxId?: string | null; name?: string; taxExempt?: boolean };
  jurisdictionApplied?: string | null; // opcional (código de la jurisdicción aplicada si deseas guardarlo)
};

const round = (n: number) => Math.round(n);

function ruleApplies(rule: TaxRateRule, line: DraftLine, orderType: OrderType): boolean {
  if (rule.orderTypeIn && !rule.orderTypeIn.includes(orderType)) return false;
  if (rule.appliesTo === 'all') return true;

  if (rule.itemCategoryIn?.length) {
    if (!line.category || !rule.itemCategoryIn.includes(line.category)) return false;
  }
  if (rule.itemTagIn?.length) {
    const tags = new Set(line.tags || []);
    let ok = false;
    for (const t of rule.itemTagIn) if (tags.has(t)) { ok = true; break; }
    if (!ok) return false;
  }
  if (rule.excludeItemTagIn?.length) {
    const tags = new Set(line.tags || []);
    for (const t of rule.excludeItemTagIn) if (tags.has(t)) return false;
  }
  // si no se definió appliesTo ni filtros, no aplica
  return Boolean(rule.itemCategoryIn?.length || rule.itemTagIn?.length || rule.excludeItemTagIn?.length);
}

function lineTotal(line: DraftLine): number {
  if (Number.isFinite(line.lineTotalCents)) return Number(line.lineTotalCents);
  const extras = (line.addonsCents || 0) + (line.optionsDeltaCents || 0);
  return (line.unitPriceCents + extras) * (line.quantity || 1);
}

function aggregateByCode(rows: Array<{ code?: string; baseCents: number }>): Array<{ code: string; baseCents: number }> {
  const acc: Record<string, number> = {};
  for (const r of rows) {
    const key = r.code || 'UNKNOWN';
    acc[key] = (acc[key] || 0) + (r.baseCents || 0);
  }
  return Object.entries(acc).map(([code, baseCents]) => ({ code, baseCents }));
}

export function calculateTaxSnapshot(input: TaxDraftInput, profile: TaxProfile): TaxSnapshot {
  // Normaliza orderType por el guion bajo del cliente
  const orderType = (input.orderType === 'dine_in' ? 'dine-in' : input.orderType) as OrderType;

  // Perfil efectivo por jurisdicción (puede sobreescribir tasas, rounding, inclusive, etc.)
  const baseProfile = profile as TaxProfile;
  const effectiveProfile = getEffectiveProfileForAddress(baseProfile, input.deliveryAddressInfo || null);

  const currency = input.currency || effectiveProfile.currency;

  // 1) Clonar líneas y (opcional) inyectar línea de delivery
  const lines: DraftLine[] = [...(input.lines || [])];

  if (
    input.deliveryFeeCents &&
    input.deliveryFeeCents > 0 &&
    effectiveProfile.delivery?.mode === 'as_line'
  ) {
    lines.push({
      lineId: 'delivery',
      quantity: 1,
      unitPriceCents: input.deliveryFeeCents,
      taxExempt: !(effectiveProfile.delivery?.taxable),
      category: 'delivery',
      tags: ['delivery_fee'],
      code: 'delivery_fee',
    });
  }

  // 2) Subtotal (suma de todos los lineTotalCents – delivery ya viene si “as_line”)
  const subTotalCents = lines.reduce((acc, l) => acc + lineTotal(l), 0);

  // 3) Impuestos por línea → por regla
  const byRate: Record<string, { code: string; label?: string; rateBps: number; baseCents: number; taxCents: number }> = {};
  const zeroRatedRows: Array<{ code?: string; baseCents: number }> = [];
  const exemptRows: Array<{ code?: string; baseCents: number }> = [];

  const addToRate = (rule: TaxRateRule, baseCents: number, taxCents: number) => {
    const key = rule.code;
    if (!byRate[key]) byRate[key] = { code: rule.code, label: rule.label, rateBps: rule.rateBps, baseCents: 0, taxCents: 0 };
    byRate[key].baseCents += baseCents;
    byRate[key].taxCents += taxCents;
  };

  for (const l of lines) {
    const lineBaseCents = lineTotal(l);
    if (lineBaseCents <= 0) continue;

    // ¿Exento explícito por línea o por B2B (si config lo permite)?
    let lineExempt = Boolean(l.taxExempt);
    if (!lineExempt && effectiveProfile?.b2bConfig?.taxExemptWithTaxId) {
      const hasTaxId = Boolean(input.customer?.taxId && String(input.customer.taxId).trim());
      if (hasTaxId || input.customer?.taxExempt) lineExempt = true;
    }
    if (lineExempt) {
      exemptRows.push({ code: 'EXEMPT', baseCents: lineBaseCents });
      continue;
    }

    // Reglas aplicables a la línea (si ninguna coincide pero hay una “all”, la consideramos)
    const rates = (effectiveProfile.rates || []);
    const matches = rates.filter(r => ruleApplies(r, l, orderType));
    const allRules = rates.filter(r => r.appliesTo === 'all' && (!r.orderTypeIn || r.orderTypeIn.includes(orderType)));
    const rules = matches.length ? matches : allRules;

    if (!rules.length) {
      // Si no hay reglas, trátalo como exento (no suma a impuestos ni a zero-rated)
      exemptRows.push({ code: 'NO_RULE', baseCents: lineBaseCents });
      continue;
    }

    // Si alguna regla marca "exempt" → toda la línea exenta
    const ruleExempt = rules.find(r => r.exempt);
    if (ruleExempt) {
      exemptRows.push({ code: ruleExempt.code || 'EXEMPT', baseCents: lineBaseCents });
      continue;
    }

    // Si alguna regla marca "zeroRated" → cuenta como base gravada 0% (sin impuesto)
    const ruleZero = rules.find(r => r.zeroRated);
    if (ruleZero) {
      zeroRatedRows.push({ code: ruleZero.code || 'ZERO', baseCents: lineBaseCents });
      continue;
    }

    // Caso normal: aplicar impuestos (posibles múltiples reglas)
    for (const r of rules) {
      const rate = (r.rateBps || 0) / 10000; // ej. 0.12
      let taxCents = 0;
      let baseForRate = lineBaseCents;

      if (effectiveProfile.pricesIncludeTax) {
        // IVA incluido: impuesto = base - base/(1+rate)
        const tax = lineBaseCents - lineBaseCents / (1 + rate);
        taxCents = round(tax);
        baseForRate = lineBaseCents - taxCents; // base neta contable
      } else {
        // Exclusivo: impuesto sobre base
        taxCents = round(lineBaseCents * rate);
        baseForRate = lineBaseCents;
      }
      addToRate(r, baseForRate, taxCents);
    }
  }

  // 4) Surcharges (cargo por servicio, etc.)
  const surcharges: Array<{ code: string; label?: string; baseCents: number; taxCents: number }> = [];

  const applySurcharges = (effectiveProfile.surcharges || []).filter(s =>
    !s.applyWhenOrderTypeIn || s.applyWhenOrderTypeIn.includes(orderType)
  );

  if (applySurcharges.length) {
    // base del recargo: todo el subtotal (puedes ajustar si quieres excluir exentos)
    const surchargeBase = subTotalCents;
    for (const s of applySurcharges) {
      const baseCents = round(surchargeBase * (s.percentBps / 10000));
      let taxCents = 0;

      if (s.taxable) {
        // buscar la tasa preferida
        const sel =
          (s.taxCode && (effectiveProfile.rates || []).find(r => r.code === s.taxCode)) ||
          (effectiveProfile.rates || []).find(r => r.appliesTo === 'all') ||
          (effectiveProfile.rates || [])[0];

        if (sel) {
          const rate = (sel.rateBps || 0) / 10000;
          if (effectiveProfile.pricesIncludeTax) {
            taxCents = round(baseCents - baseCents / (1 + rate));
          } else {
            taxCents = round(baseCents * rate);
          }
          // sumar recargo a summaryByRate bajo su tasa
          const key = sel.code;
          if (!byRate[key]) byRate[key] = { code: sel.code, label: sel.label, rateBps: sel.rateBps, baseCents: 0, taxCents: 0 };
          const baseForRate = effectiveProfile.pricesIncludeTax ? (baseCents - taxCents) : baseCents;
          byRate[key].baseCents += baseForRate;
          byRate[key].taxCents += taxCents;
        }
      }

      surcharges.push({ code: s.code, label: s.label, baseCents, taxCents });
    }
  }

  // 5) Totales
  const taxCents = Object.values(byRate).reduce((a, r) => a + r.taxCents, 0);
  // Grand total = subtotal + (si exclusive → + tax); si inclusive, el tax ya está dentro del subtotal.
  const grandTotalCents = effectiveProfile.pricesIncludeTax ? subTotalCents : subTotalCents + taxCents;

  return {
    currency,
    orderType,
    summaryByRate: Object.values(byRate),
    summaryZeroRated: zeroRatedRows.length ? aggregateByCode(zeroRatedRows) : undefined,
    summaryExempt: exemptRows.length ? aggregateByCode(exemptRows) : undefined,
    surcharges: surcharges.length ? surcharges : undefined,
    totals: { subTotalCents, taxCents, grandTotalCents },
    customer: input.customer,
    jurisdictionApplied: null, // si deseas, puedes enriquecer getEffectiveProfileForAddress para devolver el código usado
  };
}
