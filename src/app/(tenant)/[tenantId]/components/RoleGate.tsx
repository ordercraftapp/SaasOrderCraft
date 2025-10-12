// src/app/(tenant)/[tenantId]/components/RoleGate.tsx
"use client";

import { ReactNode, useMemo } from "react";
import { useAuth } from "@/app/providers";
import { useTenantId } from "@/lib/tenant/context";

type Role = "admin" | "kitchen" | "waiter" | "delivery" | "cashier" | "customer";

export function RoleGate({
  allow,
  children,
  fallback = (
    <p style={{ padding: 16, color: "crimson" }}>
      Access denied. You do not have permission to view this section.
    </p>
  ),
}: {
  allow: Role[];           // ej: ["cashier"] o ["admin","kitchen"]
  children: ReactNode;
  fallback?: ReactNode;
}) {
  const { loading, flags } = useAuth();
  const tenantId = useTenantId();

  const map = useMemo(() => {
    // Base global (comportamiento original)
    const base: Record<Role, boolean> = {
      admin: !!flags?.isAdmin,
      kitchen: !!flags?.isKitchen,
      waiter: !!flags?.isWaiter,
      delivery: !!flags?.isDelivery,
      cashier: !!flags?.isCashier,
      customer: !!flags?.isCustomer,
    };

    // Opcional: overrides por tenant si existen (sin romper tipos)
    const f: any = flags;
    const t = tenantId;

    if (f && t) {
      // 1) rolesByTenant[tenantId] = ["admin","kitchen",...]
      const arr = Array.isArray(f?.rolesByTenant?.[t]) ? (f.rolesByTenant[t] as string[]) : null;
      if (arr) {
        base.admin    = arr.includes("admin")    || base.admin;
        base.kitchen  = arr.includes("kitchen")  || base.kitchen;
        base.waiter   = arr.includes("waiter")   || base.waiter;
        base.delivery = arr.includes("delivery") || base.delivery;
        base.cashier  = arr.includes("cashier")  || base.cashier;
        base.customer = arr.includes("customer") || base.customer;
      }

      // 2) byTenant[tenantId].isAdmin / isKitchen / ...
      const bt = f?.byTenant?.[t];
      if (bt && typeof bt === "object") {
        base.admin    = bt.isAdmin    ?? base.admin;
        base.kitchen  = bt.isKitchen  ?? base.kitchen;
        base.waiter   = bt.isWaiter   ?? base.waiter;
        base.delivery = bt.isDelivery ?? base.delivery;
        base.cashier  = bt.isCashier  ?? base.cashier;
        base.customer = bt.isCustomer ?? base.customer;
      }
    }

    return base;
  }, [flags, tenantId]);

  if (loading) return <p style={{ padding: 16 }}>Cargando…</p>;

  const ok = allow.some((r) => map[r]);
  return ok ? <>{children}</> : <>{fallback}</>;
}
