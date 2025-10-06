// src/lib/tax/utils.ts

/** basis points to decimal: 1200 -> 0.12 */
export const bpsToDecimal = (bps: number) => bps / 10000;

export function roundCents(n: number): number {
  // Always keep integers; n is already cents, but we guard against floats
  return Math.round(n);
}

export function computeLineGrossCents(l: {
  unitPriceCents: number; quantity: number; addonsCents?: number; optionsDeltaCents?: number; lineTotalCents?: number;
}): number {
  if (Number.isFinite(l.lineTotalCents)) return roundCents(l.lineTotalCents!);
  const base = (l.unitPriceCents || 0) + (l.optionsDeltaCents || 0) + (l.addonsCents || 0);
  return roundCents(base * (l.quantity || 0));
}
