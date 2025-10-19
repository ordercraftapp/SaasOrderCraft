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
  const { readGeneralSettings } = makeSettingsIO(tenantId);

  const [settings, setSettings] = useState<TenantGeneralSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    // Si aún no hay tenantId (primer render), marcamos sin cargar
    if (!tenantId) {
      setSettings(null);
      setLoading(false);
      setErr(null);
      return;
    }

    setLoading(true);
    setErr(null);
    try {
      const s = await readGeneralSettings();
      setSettings(s);
    } catch (e: any) {
      setErr(e?.message || "Error loading settings");
    } finally {
      setLoading(false);
    }
  }, [tenantId, readGeneralSettings]);

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
