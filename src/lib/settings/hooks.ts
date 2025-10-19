"use client";
import { useContext, useMemo } from "react";
import { SettingsContext } from "./context";
import { makeSettingsIO } from "./storage";
import { useTenantId } from "@/lib/tenant/context";

export function useTenantSettings() {
  return useContext(SettingsContext);
}

// 🔧 Azúcar sintáctico: devuelve directamente el formateador
export function useFmtCurrency() {
  const { fmtCurrency } = useTenantSettings();
  return fmtCurrency;
}

// (Opcional) Helper para escribir settings con el tenant actual
export function useWriteGeneralSettings() {
  const tenantId = useTenantId();
  const io = useMemo(() => makeSettingsIO(tenantId), [tenantId]);
  return io.writeGeneralSettings;
}
