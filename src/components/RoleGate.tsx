// src/components/RoleGate.tsx
"use client";

import { ReactNode } from "react";
import { useAuth } from "@/app/providers";

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
  if (loading) return <p style={{ padding: 16 }}>Cargando…</p>;

  const map: Record<Role, boolean> = {
    admin: flags.isAdmin,
    kitchen: flags.isKitchen,
    waiter: flags.isWaiter,
    delivery: flags.isDelivery,
    cashier: flags.isCashier,
    customer: flags.isCustomer,
  };

  const ok = allow.some((r) => map[r]);
  return ok ? <>{children}</> : <>{fallback}</>;
}
