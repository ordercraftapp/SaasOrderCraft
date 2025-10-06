// src/lib/server/config.ts
import { db } from "@/lib/firebase/admin";

export type PricingConfig = {
  currency: string;              // "USD" por defecto
  taxRate: number;               // 0..1 (ej. 0.12 => 12%)
  serviceFeePercent: number;     // 0..1
  serviceFeeFixed: number;       // monto fijo
  allowTips: boolean;            // permitir propina
  discountsApplyTo: "subtotal" | "subtotal_plus_service"; // dónde aplica el cupón
};

export async function getPricingConfig(): Promise<PricingConfig> {
  const snap = await db.collection("config").doc("pricing").get();
  const d = snap.exists ? (snap.data() as any) : {};
  return {
    currency: (d?.currency || "USD").toString().toUpperCase(),
    taxRate: Number(d?.taxRate ?? 0),
    serviceFeePercent: Number(d?.serviceFeePercent ?? 0),
    serviceFeeFixed: Number(d?.serviceFeeFixed ?? 0),
    allowTips: !!d?.allowTips,
    discountsApplyTo: (d?.discountsApplyTo as any) === "subtotal_plus_service"
      ? "subtotal_plus_service"
      : "subtotal",
  };
}

// ---- COUPONS ----
export type CouponDoc = {
  code: string;                  // MAYUS
  type: "percent" | "fixed";
  value: number;                 // percent: 0..1, fixed: monto
  isActive: boolean;
  currency?: string | null;      // si se limita a una moneda
  minSubtotal?: number | null;   // monto mínimo
  // Futuro: maxRedemptions, validFrom/To, users, etc.
};

export async function getCoupon(code?: string): Promise<CouponDoc | null> {
  if (!code) return null;
  const id = code.trim().toUpperCase();
  if (!id) return null;
  const snap = await db.collection("coupons").doc(id).get();
  if (!snap.exists) return null;
  const d = snap.data() as any;
  return {
    code: id,
    type: d.type === "percent" ? "percent" : "fixed",
    value: Number(d.value ?? 0),
    isActive: !!d.isActive,
    currency: d.currency ? String(d.currency).toUpperCase() : null,
    minSubtotal: d.minSubtotal != null ? Number(d.minSubtotal) : null,
  };
}
