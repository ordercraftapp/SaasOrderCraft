// src/lib/tax/types.ts
export type PricingMode = 'tax_inclusive' | 'tax_exclusive';
export type RoundingMode = 'per_line' | 'per_receipt';

export interface ServiceChargeConfig {
  enabled: boolean;
  /** basis points: 1000 = 10.00% */
  percentBps: number;
  taxable: boolean;
}

export interface TaxProfile {
  id?: string;
  name: string;
  currency: string;             // e.g. "GTQ", "USD"
  pricingMode: PricingMode;     // inclusive vs exclusive
  rounding: RoundingMode;       // per_line vs per_receipt
  /** Standard single rate for Phase A, in basis points: 1200 = 12.00% */
  standardRateBps: number;
  serviceCharge?: ServiceChargeConfig;
  /** Optional metadata (jurisdiction, notes) */
  meta?: Record<string, any>;
}

export interface OrderDraftLine {
  lineId: string;
  name?: string;
  quantity: number;
  /** cents (integer). Unit base price before options/addons deltas. */
  unitPriceCents: number;
  /** optional deltas already calculated in cents (sum of addons/options) */
  addonsCents?: number;
  optionsDeltaCents?: number;
  /** if provided, we use it directly (takes precedence). */
  lineTotalCents?: number;
  /** Exempt lines won’t be taxed */
  taxExempt?: boolean;
}

export interface OrderDraftInput {
  currency: string;
  orderType?: 'dine_in' | 'takeout' | 'delivery';
  lines: OrderDraftLine[];
  /** Optional delivery fee and tips handled elsewhere for Phase A */
  deliveryFeeCents?: number;
  /** Service charge may be computed from profile (percent). If you already computed, pass here to bypass. */
  serviceChargeOverrideCents?: number;
  /** For audit */
  customer?: { taxId?: string; name?: string };
}

export interface TaxLineBreakdown {
  lineId: string;
  baseCents: number; // taxable base
  taxes: Array<{ code: string; rateBps: number; taxCents: number }>;
  taxableCents: number; // equals baseCents if single rate
  exempt?: boolean;
}

export interface TaxSummaryByRate {
  code: string;
  rateBps: number;
  baseCents: number;
  taxCents: number;
}

export interface TaxSnapshot {
  profileId?: string;
  pricingMode: PricingMode;
  lineBreakdown: TaxLineBreakdown[];
  surcharges: Array<{
    type: 'service_charge';
    baseCents: number;
    taxCents: number;
    code: string;
    rateBps: number;
  }>;
  summaryByRate: TaxSummaryByRate[];
  totals: {
    subTotalCents: number;   // sum of bases (taxable + exempt)
    taxCents: number;
    grandTotalCents: number; // base + tax + surcharges (+ their tax)
  };
  rounding: { mode: RoundingMode; deltaCents: number };
  currency: string;
  jurisdictionResolved?: Record<string, any>;
  customer?: { taxId?: string; name?: string };
}
