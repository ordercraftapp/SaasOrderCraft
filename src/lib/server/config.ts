// src/lib/server/config.ts
import { tColAdmin } from "@/lib/db_admin";

export type PricingConfig = {
  currency: string;              // "USD" por defecto
  taxRate: number;               // 0..1 (ej. 0.12 => 12%)
  serviceFeePercent: number;     // 0..1
  serviceFeeFixed: number;       // monto fijo
  allowTips: boolean;            // permitir propina
  discountsApplyTo: "subtotal" | "subtotal_plus_service"; // dónde aplica el cupón
};

export type CouponDoc = {
  code: string;                  // MAYUS
  type: "percent" | "fixed";
  value: number;                 // percent: 0..1, fixed: monto
  isActive: boolean;
  currency?: string | null;      // si se limita a una moneda
  minSubtotal?: number | null;   // monto mínimo
  // Futuro: maxRedemptions, validFrom/To, users, etc.
};

export type ConfigContext = { tenantId?: string };

export async function getPricingConfig(ctx?: ConfigContext): Promise<PricingConfig> {
  const tenantId = ctx?.tenantId;
  if (!tenantId) {
    // En migración multi-tenant, forzamos tenantId para evitar lecturas globales
    throw new Error("TENANT_REQUIRED_FOR_CONFIG");
  }

  // Lee: tenants/{tenantId}/config/pricing
  const snap = await tColAdmin("config", tenantId).doc("pricing").get();
  const d = snap.exists ? (snap.data() as any) : {};
  return {
    currency: (d?.currency || "USD").toString().toUpperCase(),
    taxRate: Number(d?.taxRate ?? 0),
    serviceFeePercent: Number(d?.serviceFeePercent ?? 0),
    serviceFeeFixed: Number(d?.serviceFeeFixed ?? 0),
    allowTips: !!d?.allowTips,
    discountsApplyTo:
      (d?.discountsApplyTo as any) === "subtotal_plus_service"
        ? "subtotal_plus_service"
        : "subtotal",
  };
}

// ---- COUPONS ----
export async function getCoupon(code?: string, ctx?: ConfigContext): Promise<CouponDoc | null> {
  if (!code) return null;
  const tenantId = ctx?.tenantId;
  if (!tenantId) {
    // Evitamos consultas globales en modo multi-tenant
    throw new Error("TENANT_REQUIRED_FOR_CONFIG");
  }

  const id = code.trim().toUpperCase();
  if (!id) return null;

  // Tus cupones usan ID aleatorio y guardan el código en el campo `code`
  const q = await tColAdmin("coupons", tenantId)
    .where("code", "==", id)
    .limit(1)
    .get();

  const doc = q.docs[0];
  if (!doc?.exists) return null;

  const d = doc.data() as any;
  return {
    code: id,
    type: d.type === "percent" ? "percent" : "fixed",
    value: Number(d.value ?? 0),
    isActive: !!d.isActive,
    currency: d.currency ? String(d.currency).toUpperCase() : null,
    minSubtotal: d.minSubtotal != null ? Number(d.minSubtotal) : null,
  };
}
