// src/app/(tenant)/[tenantId]/app/admin/settings/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import Protected from "@/app/(tenant)/[tenantId]/components/Protected";
import AdminOnly from "@/app/(tenant)/[tenantId]/components/AdminOnly";
import ToolGate from "@/components/ToolGate";
import "@/lib/firebase/client";
import { useTenantSettings } from "@/lib/settings/hooks";
import { writeGeneralSettings } from "@/lib/settings/storage";
import { useTenantId } from "@/lib/tenant/context";

// 👉 Pagos
import { getFirestore, doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { getAuth } from "firebase/auth";

// 🔤 i18n
import { t as translate } from "@/lib/i18n/t";

const CURRENCIES = [
  { code: "USD", label: "USD — US Dollar" },
  { code: "GTQ", label: "GTQ — Quetzal (Guatemala)" },
  { code: "MXN", label: "MXN — Peso mexicano" },
  { code: "EUR", label: "EUR — Euro" },
  { code: "COP", label: "COP — Peso colombiano" },
  { code: "ARS", label: "ARS — Peso argentino" },
  { code: "PEN", label: "PEN — Sol peruano" },
  { code: "CLP", label: "CLP — Peso chileno" },
];

const LOCALES = [
  { code: "es-GT", label: "Español (Guatemala)" },
  { code: "es-MX", label: "Español (México)" },
  { code: "es-ES", label: "Español (España)" },
  { code: "en-US", label: "English (United States)" },
  { code: "en-GB", label: "English (United Kingdom)" },
  { code: "pt-BR", label: "Português (Brasil)" },
  { code: "fr-FR", label: "Français (France)" },
];

const LANGUAGES = [
  { code: "es", label: "Español" },
  { code: "en", label: "English" },
  { code: "pt", label: "Português" },
  { code: "fr", label: "Français" },
];

// ✅ Métodos de pago por defecto
const DEFAULT_PAYMENTS: Record<string, boolean> = {
  cash: true,
  card: true,
  paypal: true,
};

function normalizeLanguageCode(value?: string): "es" | "en" | "pt" | "fr" {
  const base = String(value || "").split("-")[0].toLowerCase();
  if (base === "en" || base === "es" || base === "pt" || base === "fr") return base as any;
  return "es";
}

export default function AdminSettingsPage() {
  const tenantId = useTenantId();
  const { settings, loading, error, fmtCurrency, reload } = useTenantSettings();

  const lang = useMemo(() => {
    try {
      if (typeof window !== "undefined") {
        const ls = localStorage.getItem("tenant.language");
        if (ls) return ls;
      }
    } catch {}
    return (settings as any)?.language;
  }, [settings]);

  const tt = (key: string, fallback: string, vars?: Record<string, unknown>) => {
    const s = translate(lang, key, vars);
    return s === key ? fallback : s;
  };

  const [currency, setCurrency] = useState<string>("USD");
  const [locale, setLocale] = useState<string>("en-US");
  const [uiLanguage, setUiLanguage] = useState<"es" | "en" | "pt" | "fr">("es");

  // ===========================
  //   SECCIÓN DE PAGOS (TENANT)
  // ===========================
  const db = getFirestore();
  const [payments, setPayments] = useState<Record<string, boolean>>(DEFAULT_PAYMENTS);
  const [paymentsLoading, setPaymentsLoading] = useState<boolean>(true);
  const [paymentsSaving, setPaymentsSaving] = useState<boolean>(false);
  const [paymentsSaved, setPaymentsSaved] = useState<null | "ok" | "err">(null);

  // 🔁 **NUEVO**: asegura token/claims frescos antes de tocar Firestore del tenant
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!tenantId) return;
      const auth = getAuth();
      const u = auth.currentUser;
      if (!u) return;
      try {
        const idToken = await u.getIdToken(true);
        const resp = await fetch(`/${tenantId}/app/api/auth/refresh-role`, {
          method: "POST",
          headers: { Authorization: `Bearer ${idToken}` },
          cache: "no-store",
          credentials: "same-origin",
        }).catch(() => null);
        if (resp?.ok) {
          const data = await resp.json().catch(() => ({}));
          if (data?.claimsUpdated) {
            await u.getIdToken(true);
          }
        }
      } catch {}
      if (!cancelled) {
        // no-op; simplemente garantiza que, al siguiente efecto, los claims ya estén OK
      }
    })();
    return () => { cancelled = true; };
  }, [tenantId]);

  // Cargar paymentProfile desde tenants/{tenantId}/paymentProfile/default
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      if (!tenantId) { setPaymentsLoading(false); return; }
      setPaymentsLoading(true);
      setPaymentsSaved(null);
      try {
        const ref = doc(db, `tenants/${tenantId}/paymentProfile/default`);
        const snap = await getDoc(ref);
        if (cancelled) return;
        if (snap.exists()) {
          const data = snap.data() as any;
          const merged = {
            ...DEFAULT_PAYMENTS,
            cash: typeof data.cash === "boolean" ? data.cash : DEFAULT_PAYMENTS.cash,
            card: typeof data.card === "boolean" ? data.card : DEFAULT_PAYMENTS.card,
            paypal: typeof data.paypal === "boolean" ? data.paypal : DEFAULT_PAYMENTS.paypal,
          };
          setPayments(merged);
        } else {
          setPayments({ ...DEFAULT_PAYMENTS });
        }
      } catch (e) {
        console.error("load paymentProfile error:", e);
        setPayments({ ...DEFAULT_PAYMENTS });
      } finally {
        if (!cancelled) setPaymentsLoading(false);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [db, tenantId]);

  // Guardar paymentProfile en tenants/{tenantId}/paymentProfile/default
  async function onSavePayments(e?: React.FormEvent) {
    if (e) e.preventDefault();
    if (!tenantId) return;
    setPaymentsSaving(true);
    setPaymentsSaved(null);
    try {
      const ref = doc(db, `tenants/${tenantId}/paymentProfile/default`);
      await setDoc(
        ref,
        {
          tenantId,
          cash: !!payments.cash,
          card: !!payments.card,
          paypal: !!payments.paypal,
          updatedAt: serverTimestamp(),
          createdAt: serverTimestamp(),
        },
        { merge: true }
      );
      setPaymentsSaved("ok");
    } catch (err) {
      console.error("save paymentProfile error:", err);
      setPaymentsSaved("err");
    } finally {
      setPaymentsSaving(false);
    }
  }

  // ===========================
  //   FIN SECCIÓN DE PAGOS
  // ===========================

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<null | "ok" | "err">(null);

  useEffect(() => {
    if (settings) {
      setCurrency(settings.currency || "USD");
      setLocale(settings.currencyLocale || "en-US");
      let fromFS = normalizeLanguageCode((settings as any).language);
      if (!fromFS) {
        try {
          if (typeof window !== "undefined") {
            const ls = localStorage.getItem("tenant.language") || "";
            fromFS = normalizeLanguageCode(ls);
          }
        } catch {}
      }
      setUiLanguage(fromFS || "es");
    }
  }, [settings]);

  const example = useMemo(() => fmtCurrency(1234.56), [fmtCurrency]);

  async function onSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaved(null);
    try {
      await writeGeneralSettings({
        currency,
        currencyLocale: locale,
        language: uiLanguage,
      } as any);

      if (typeof window !== "undefined") localStorage.setItem("tenant.language", uiLanguage);

      await reload();
      setSaved("ok");
    } catch (e) {
      console.error(e);
      setSaved("err");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Protected>
      <AdminOnly>
        <ToolGate feature="settings">
          <main className="container py-4">
            <h1 className="mb-3">{tt("admin.settings.title", "⚙️ General Settings")}</h1>
            <p className="text-muted mb-4">
              {tt("admin.settings.subtitle","Adjust the currency, locale and customer-facing language.")}
            </p>

            {loading && <div className="alert alert-info">{tt("admin.settings.loading", "Loading settings…")}</div>}
            {error && <div className="alert alert-danger">{tt("admin.settings.errorPrefix", "Error:")} {error}</div>}

            {!loading && (
              <>
                {/* Settings generales */}
                <form className="card p-3 shadow-sm mb-4" onSubmit={onSave}>
                  {/* ... (sin cambios) ... */}
                  <div className="row gy-3">
                    <div className="col-12 col-md-4">
                      <label className="form-label fw-semibold">{tt("admin.settings.currency.label", "Currency (ISO)")}</label>
                      <select className="form-select" value={currency} onChange={(e) => setCurrency(e.target.value)}>
                        {CURRENCIES.map((c) => (<option key={c.code} value={c.code}>{c.label}</option>))}
                      </select>
                      <div className="form-text">
                        {tt("admin.settings.currency.help", "Affects symbol and money rules. Ex.:")} {fmtCurrency(1500)}
                      </div>
                    </div>

                    <div className="col-12 col-md-4">
                      <label className="form-label fw-semibold">{tt("admin.settings.locale.label", "Locale")}</label>
                      <select className="form-select" value={locale} onChange={(e) => setLocale(e.target.value)}>
                        {LOCALES.map((l) => (<option key={l.code} value={l.code}>{l.label}</option>))}
                      </select>
                      <div className="form-text">
                        {tt("admin.settings.locale.help.prefix","Affects separators, order and format. Ex.:")}{" "}
                        {new Intl.NumberFormat(locale, { style: "currency", currency }).format(1500)}
                      </div>
                    </div>

                    <div className="col-12 col-md-4">
                      <label className="form-label fw-semibold">{tt("admin.settings.language.label","Language (customer area)")}</label>
                      <select className="form-select" value={uiLanguage} onChange={(e) => setUiLanguage(normalizeLanguageCode(e.target.value))}>
                        {LANGUAGES.map((l) => (<option key={l.code} value={l.code}>{l.label}</option>))}
                      </select>
                      <div className="form-text">
                        {tt("admin.settings.language.help","Defines the interface language customers will see.")}
                      </div>
                    </div>
                  </div>

                  <hr className="my-4" />

                  <div className="d-flex align-items-center gap-3">
                    <button className="btn btn-primary" disabled={saving}>
                      {saving ? tt("admin.settings.btn.saving","Saving…") : tt("admin.settings.btn.save","Save changes")}
                    </button>
                    {saved === "ok" && <span className="text-success">{tt("admin.settings.saved.ok","✅ Saved")}</span>}
                    {saved === "err" && <span className="text-danger">{tt("admin.settings.saved.err","❌ Error saving")}</span>}
                  </div>

                  <div className="mt-4">
                    <span className="badge text-bg-light">
                      {tt("admin.settings.preview.currency","Currency preview:")} <strong>{example}</strong>
                    </span>
                  </div>
                </form>

                {/* ===========================
                    PAYMENTS (paymentProfile)
                   =========================== */}
                <form className="card p-3 shadow-sm" onSubmit={onSavePayments}>
                  <fieldset disabled={paymentsLoading || paymentsSaving}>
                    <legend className="h6 mb-3">{tt("admin.settings.payments.title", "Payments")}</legend>

                    {paymentsLoading && (
                      <div className="alert alert-info py-2 mb-3">
                        {tt("admin.settings.payments.loading", "Loading payment profile…")}
                      </div>
                    )}

                    <div className="row gy-2">
                      <div className="col-12 col-md-4">
                        <div className="form-check form-switch">
                          <input id="pay-cash" className="form-check-input" type="checkbox"
                                 checked={!!payments.cash}
                                 onChange={(e) => setPayments((p) => ({ ...p, cash: e.target.checked }))} />
                          <label className="form-check-label" htmlFor="pay-cash">
                            {tt("admin.settings.payments.cash", "Cash")}
                          </label>
                        </div>
                      </div>

                      <div className="col-12 col-md-4">
                        <div className="form-check form-switch">
                          <input id="pay-card" className="form-check-input" type="checkbox"
                                 checked={!!payments.card}
                                 onChange={(e) => setPayments((p) => ({ ...p, card: e.target.checked }))} />
                          <label className="form-check-label" htmlFor="pay-card">
                            {tt("admin.settings.payments.card", "Credit/Debit Card")}
                          </label>
                        </div>
                      </div>

                      <div className="col-12 col-md-4">
                        <div className="form-check form-switch">
                          <input id="pay-paypal" className="form-check-input" type="checkbox"
                                 checked={!!payments.paypal}
                                 onChange={(e) => setPayments((p) => ({ ...p, paypal: e.target.checked }))} />
                          <label className="form-check-label" htmlFor="pay-paypal">
                            {tt("admin.settings.payments.paypal", "PayPal")}
                          </label>
                        </div>
                      </div>
                    </div>

                    <div className="form-text mt-2 mb-3">
                      {tt("admin.settings.payments.help","Toggle which payment methods are shown at checkout. Saved in tenants/{tenantId}/paymentProfile/default.")}
                    </div>

                    <div className="d-flex align-items-center gap-3">
                      <button className="btn btn-outline-primary" type="submit">
                        {paymentsSaving ? tt("admin.settings.btn.saving","Saving…") : tt("admin.settings.payments.save","Save payments")}
                      </button>
                      {paymentsSaved === "ok" && <span className="text-success">{tt("admin.settings.saved.ok", "✅ Saved")}</span>}
                      {paymentsSaved === "err" && <span className="text-danger">{tt("admin.settings.saved.err", "❌ Error saving")}</span>}
                    </div>
                  </fieldset>
                </form>
                {/* ===========================
                    FIN PAYMENTS
                   =========================== */}
              </>
            )}
          </main>
        </ToolGate>
      </AdminOnly>
    </Protected>
  );
}
