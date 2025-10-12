// src/app/(tenant)/[tenantId]/components/AdminOnly.tsx
"use client";
import React from "react";
import { useAuth } from "@/app/providers";
import { useTenantId } from "@/lib/tenant/context";

export default function AdminOnly({ children }: { children: React.ReactNode }) {
  const { loading, flags } = useAuth();
  const tenantId = useTenantId();

  // ✅ Respeta el flag global y agrega checks opcionales por tenant si existen.
  const isAdmin = React.useMemo(() => {
    if (flags?.isAdmin === true) return true;

    // Evita errores de tipos (cambio mínimo sin alterar tus defs)
    const f: any = flags;
    const t = tenantId;

    if (!f || !t) return false;
    if (f.tenants?.[t]?.isAdmin === true) return true;
    if (f.byTenant?.[t]?.isAdmin === true) return true;
    if (Array.isArray(f.rolesByTenant?.[t]) && f.rolesByTenant[t].includes("admin")) return true;
    if (Array.isArray(f.roles) && f.roles.includes("admin")) return true;

    return false;
  }, [flags, tenantId]);

  if (loading) return <p style={{ padding: 24 }}>Cargando…</p>;
  if (!isAdmin) return <p style={{ padding: 24, color: "crimson" }}>Access denied.</p>;
  return <>{children}</>;
}
