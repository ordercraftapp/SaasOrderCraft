// src/lib/settings/context.tsx //
"use client";

import React, { createContext, useCallback, useEffect, useMemo, useState } from "react";
import { makeSettingsIO, type TenantGeneralSettings } from "./storage";
import { useTenantId } from "@/lib/tenant/context";

export type SettingsContextValue = {
  settings: TenantGeneralSettings | null;
  loading: boolean;
  error?: string | null;
  // Currency helper centralizado
  fmtCurrency: (v?: number | string | null, opts?: Intl.NumberFormatOptions) => string;
  // Refrescar (por si cambian desde otra pestaña)
  reload: () => Promise<void>;
};

export const SettingsContext = createContext<SettingsContextValue>({
  settings: null,
  loading: true,
  error: null,
  fmtCurrency: (v?: number | string | null) => String(v ?? 0),
  reload: async () => {},
});

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const tenantId = useTenantId();

  // ⚠️ ANTES (causaba loop):
  // const { readGeneralSettings } = makeSettingsIO(tenantId);

  // ✅ AHORA: memoiza el IO por tenantId
  const io = useMemo(() => {
    //console.log("[settings] makeSettingsIO tenantId:", tenantId); // 🧪 DEBUG
    return makeSettingsIO(tenantId);
  }, [tenantId]);

  const [settings, setSettings] = useState<TenantGeneralSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!tenantId) {
      //console.log("[settings] load skipped: tenantId is null/undefined"); // 🧪 DEBUG
      setSettings(null);
      setLoading(false);
      setErr(null);
      return;
    }

    setLoading(true);
    setErr(null);

    try {
      //console.log("[settings] loading for tenantId:", tenantId); // 🧪 DEBUG
      const s = await io.readGeneralSettings(); // ✅ usa el IO memoizado
      //console.log("[settings] loaded:", s); // 🧪 DEBUG
      setSettings(s);
    } catch (e: any) {
      console.error("[settings] load error:", e); // 🧪 DEBUG
      setErr(e?.message || "Error loading settings");
    } finally {
      setLoading(false);
    }
  }, [tenantId, io]); // ✅ estable porque `io` está memoizado por tenantId

  useEffect(() => {
    void load();
  }, [load]);

  const fmtCurrency = useCallback(
    (v?: number | string | null, opts?: Intl.NumberFormatOptions) => {
      const num = Number.isFinite(Number(v)) ? Number(v) : 0;
      const cur = settings?.currency || "USD";
      const loc = settings?.currencyLocale || "en-US";
      try {
        return new Intl.NumberFormat(loc, { style: "currency", currency: cur, ...opts }).format(num);
      } catch {
        return `${cur} ${num.toFixed(2)}`;
      }
    },
    [settings]
  );

  const value = useMemo<SettingsContextValue>(
    () => ({ settings, loading, error, fmtCurrency, reload: load }),
    [settings, loading, error, fmtCurrency, load]
  );

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}
