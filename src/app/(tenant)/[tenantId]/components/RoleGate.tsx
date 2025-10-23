// src/app/(tenant)/[tenantId]/components/RoleGate.tsx
"use client";

import { ReactNode, useEffect, useMemo, useState } from "react";
import { useAuth } from "@/app/(tenant)/[tenantId]/app/providers";
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
  // ⬇️ añadimos 'user' para pedir idToken al servidor
  const { loading, flags, user } = useAuth();
  const tenantId = useTenantId();

  // ⬇️ NUEVO: rol resuelto por el servidor (tenant-aware)
  const [serverRole, setServerRole] = useState<Role | null>(null);
  const [serverLoading, setServerLoading] = useState(false);

  // ⬇️ NUEVO: refresca rol en cookies y obtén el rol efectivo para este tenant
  useEffect(() => {
    let alive = true;

    (async () => {
      try {
        if (!tenantId || !user) return;
        setServerLoading(true);

        const idToken = await user.getIdToken(/*forceRefresh*/ true);
        const resp = await fetch(`/${tenantId}/app/api/auth/refresh-role`, {
          method: "POST",
          headers: { Authorization: `Bearer ${idToken}` },
          cache: "no-store",
        });

        const data = await resp.json().catch(() => ({} as any));
        if (!alive) return;

        if (resp.ok && data?.ok === true && data?.role) {
          const r = String(data.role).toLowerCase() as Role;
          if (r === "admin" || r === "kitchen" || r === "cashier" || r === "waiter" || r === "delivery" || r === "customer") {
            setServerRole(r);
          }
        }
      } catch {
        // Silencioso: si falla seguimos con flags del cliente
      } finally {
        if (alive) setServerLoading(false);
      }
    })();

    return () => { alive = false; };
  }, [tenantId, user]);

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

    // ⬇️ NUEVO: si el servidor devolvió rol para este tenant, lo priorizamos
    if (serverRole) {
      // Limpio: habilita el rol específico. (admin ya cubre todo en la lógica de tus toolgates)
      base.admin    = serverRole === "admin"    || base.admin;
      base.kitchen  = serverRole === "kitchen"  || base.kitchen;
      base.waiter   = serverRole === "waiter"   || base.waiter;
      base.delivery = serverRole === "delivery" || base.delivery;
      base.cashier  = serverRole === "cashier"  || base.cashier;
      base.customer = serverRole === "customer" || base.customer;
    }

    return base;
  }, [flags, tenantId, serverRole]);

  // Mantén UX consistente con tu componente original
  if (loading || serverLoading) return <p style={{ padding: 16 }}>Cargando…</p>;

  const ok = allow.some((r) => map[r]);
  return ok ? <>{children}</> : <>{fallback}</>;
}
