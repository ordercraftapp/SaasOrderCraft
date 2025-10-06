// src/lib/settings/hooks.ts
"use client";
import { useContext } from "react";
import { SettingsContext } from "./context";

export function useTenantSettings() {
  return useContext(SettingsContext);
}

// 🔧 Azúcar sintáctico: devuelve directamente el formateador
export function useFmtCurrency() {
  const { fmtCurrency } = useTenantSettings();
  return fmtCurrency;
}
