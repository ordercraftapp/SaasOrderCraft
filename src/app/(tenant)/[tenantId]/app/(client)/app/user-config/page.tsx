// src/app/(tenant)/[tenant]/app/(client)/user-config/page.tsx
"use client";

import React, { useEffect, useMemo, useState } from "react";
import Protected from "@/app/(tenant)/[tenantId]/components/Protected";
import { useAuth } from "@/app/providers";

// Firebase Auth (para cambiar contraseña)
import "@/lib/firebase/client";
import {
  getAuth,
  EmailAuthProvider,
  reauthenticateWithCredential,
  updatePassword,
} from "firebase/auth";

import { useTenantSettings } from "@/lib/settings/hooks";
import { t, getLang } from "@/lib/i18n/t";

import { useParams } from "next/navigation"; // 👈 tenant desde la URL

type Addr = {
  line1: string;
  city: string;
  country: string;
  zip: string;
  notes: string;
};

type Customer = {
  uid: string;
  email: string | null;
  displayName: string | null;
  phone: string | null;
  addresses: {
    home: Addr;
    office: Addr;
  };
  billing?: {
    name?: string;
    taxId?: string; // NIT
  };
};

type ApiGet = { ok?: boolean; error?: string; customer?: Customer };
type ApiPut = { ok?: boolean; error?: string; customer?: Customer };

// Helper mínimo: reintenta una vez si hay 401 forzando refresh del ID token
async function fetchWithRetryAuth(
  input: RequestInfo | URL,
  init: RequestInit,
  getFreshToken: () => Promise<string | null>
) {
  const res = await fetch(input, init);
  if (res.status !== 401) return res;

  const fresh = await getFreshToken();
  if (!fresh) return res;

  const nextInit: RequestInit = {
    ...init,
    headers: {
      ...(init.headers || {}),
      Authorization: `Bearer ${fresh}`,
    } as HeadersInit,
  };
  return fetch(input, nextInit);
}

// 👇 Hook para obtener el prefijo tenant-aware: "/{tenantId}/app"
function useTenantApiBase() {
  // ⬇️ antes: useParams<{ tenant: string }>();
  const params = useParams<{ tenantId: string }>();
  const tenantId = (params?.tenantId || "").trim();
  // Normalizamos a "/{tenantId}/app" o "/app" si no hay tenant
  return tenantId ? `/${tenantId}/app` : `/app`;
}

// Pequeño helper local para construir URLs absolutas same-origin (respeta CSP 'self')
function useApiUrl() {
  const apiBase = useTenantApiBase();
  return (p: string) => {
    const rel = p.startsWith("/") ? p : `/${p}`;
    if (typeof window === "undefined") return `${apiBase}${rel}`;
    return new URL(`${apiBase}${rel}`, window.location.origin).toString();
  };
}

function useCustomer() {
  const { idToken } = useAuth();
  const apiBase = useTenantApiBase(); // 👈 prefijo tenant-aware
  const makeUrl = useApiUrl();        // 👈 URLs absolutas same-origin

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [cust, setCust] = useState<Customer | null>(null);

  const headers: HeadersInit = useMemo(() => {
    const h: HeadersInit = { "Content-Type": "application/json" };
    if (idToken) (h as any).Authorization = `Bearer ${idToken}`;
    return h;
  }, [idToken]);

  const getFreshToken = async () => {
    try {
      const auth = getAuth();
      const u = auth.currentUser;
      if (!u) return null;
      const fresh = await u.getIdToken(true);
      return fresh || null;
    } catch {
      return null;
    }
  };

  const refresh = async () => {
    try {
      setErr(null);
      setLoading(true);
      const res = await fetchWithRetryAuth(
        makeUrl("/${tenantId}/app//api/customers/me"), // 👈 antes: `${apiBase}/api/customers/me`
        { headers, cache: "no-store" },
        getFreshToken
      );
      const data: ApiGet = await res.json().catch(() => ({} as any));
      if (!res.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${res.status}`);
      setCust(data.customer || null);
    } catch (e: any) {
      setErr(e?.message || "Could not load profile");
      setCust(null);
    } finally {
      setLoading(false);
    }
  };

  const saveProfile = async (payload: { displayName?: string; phone?: string }) => {
    const res = await fetchWithRetryAuth(
      makeUrl("/${tenantId}/app//api/customers/me"), // 👈 antes: `${apiBase}/api/customers/me`
      {
        method: "PUT",
        headers,
        body: JSON.stringify(payload),
      },
      getFreshToken
    );
    const data: ApiPut = await res.json().catch(() => ({} as any));
    if (!res.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${res.status}`);
    setCust(data.customer || null);
    return data.customer;
  };

  const saveAddresses = async (addresses: { home?: Partial<Addr>; office?: Partial<Addr> }) => {
    const res = await fetchWithRetryAuth(
      makeUrl("/${tenantId}/app/api/customers/me"), // 👈 antes: `${apiBase}/api/customers/me`
      {
        method: "PUT",
        headers,
        body: JSON.stringify({ addresses }),
      },
      getFreshToken
    );
    const data: ApiPut = await res.json().catch(() => ({} as any));
    if (!res.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${res.status}`);
    setCust(data.customer || null);
    return data.customer;
  };

  const saveBilling = async (billing: { name?: string; taxId?: string }) => {
    const res = await fetchWithRetryAuth(
      makeUrl("/${tenantId}/app/api/customers/me"), // 👈 antes: `${apiBase}/api/customers/me`
      {
        method: "PUT",
        headers,
        body: JSON.stringify({ billing }),
      },
      getFreshToken
    );
    const data: ApiPut = await res.json().catch(() => ({} as any));
    if (!res.ok || data?.ok === false) throw new Error(data?.error || `HTTP ${res.status}`);
    setCust(data.customer || null);
    return data.customer;
  };

  useEffect(() => {
    if (!idToken) return;
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idToken, apiBase]); // 👈 si cambia tenant en la URL, refresca

  return { loading, err, cust, refresh, saveProfile, saveAddresses, saveBilling } as const;
}

function UserConfigInner() {
  const { user } = useAuth();
  const { settings } = useTenantSettings();
  const rawLang =
    (settings as any)?.language ??
    (typeof window !== "undefined" ? localStorage.getItem("tenant.language") || undefined : undefined);
  const lang = getLang(rawLang);

  const { loading, err, cust, saveProfile, saveAddresses, saveBilling, refresh } = useCustomer();

  // Form state
  const [displayName, setDisplayName] = useState("");
  const [phone, setPhone] = useState("");
  const [home, setHome] = useState<Addr>({ line1: "", city: "", country: "", zip: "", notes: "" });
  const [office, setOffice] = useState<Addr>({ line1: "", city: "", country: "", zip: "", notes: "" });

  const [busyProfile, setBusyProfile] = useState(false);
  const [busyAddr, setBusyAddr] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  // ➕ Facturación
  const [billingName, setBillingName] = useState<string>("");
  const [billingTaxId, setBillingTaxId] = useState<string>("");
  const [busyBilling, setBusyBilling] = useState(false);

  // Password change
  const [currPass, setCurrPass] = useState("");
  const [newPass, setNewPass] = useState("");
  const [newPass2, setNewPass2] = useState("");
  const [busyPwd, setBusyPwd] = useState(false);
  const [currPassError, setCurrPassError] = useState<string | null>(null);

  useEffect(() => {
    if (!cust) return;
    setDisplayName(cust.displayName || "");
    setPhone(cust.phone || "");
    setHome({
      line1: cust.addresses?.home?.line1 || "",
      city: cust.addresses?.home?.city || "",
      country: cust.addresses?.home?.country || "",
      zip: cust.addresses?.home?.zip || "",
      notes: cust.addresses?.home?.notes || "",
    });
    setOffice({
      line1: cust.addresses?.office?.line1 || "",
      city: cust.addresses?.office?.city || "",
      country: cust.addresses?.office?.country || "",
      zip: cust.addresses?.office?.zip || "",
      notes: cust.addresses?.office?.notes || "",
    });
    setBillingName(cust.billing?.name || "");
    setBillingTaxId(cust.billing?.taxId || "");
  }, [cust]);

  const onSaveProfile = async () => {
    try {
      setErrMsg(null);
      setMsg(null);
      setBusyProfile(true);
      await saveProfile({ displayName, phone });
      setMsg(t(lang, "uc.profile.updated"));
    } catch (e: any) {
      setErrMsg(e?.message || t(lang, "uc.profile.saveError"));
    } finally {
      setBusyProfile(false);
    }
  };

  const onSaveAddresses = async () => {
    try {
      setErrMsg(null);
      setMsg(null);
      setBusyAddr(true);
      await saveAddresses({ home, office });
      setMsg(t(lang, "uc.addresses.saved"));
    } catch (e: any) {
      setErrMsg(e?.message || t(lang, "uc.addresses.saveError"));
    } finally {
      setBusyAddr(false);
    }
  };

  const onSaveBilling = async () => {
    try {
      setErrMsg(null);
      setMsg(null);
      setBusyBilling(true);
      await saveBilling({ name: billingName, taxId: billingTaxId });
      setMsg(t(lang, "uc.billing.saved"));
    } catch (e: any) {
      setErrMsg(e?.message || t(lang, "uc.billing.saveError"));
    } finally {
      setBusyBilling(false);
    }
  };

  const onChangePassword = async () => {
    try {
      setErrMsg(null);
      setMsg(null);
      setCurrPassError(null);

      if (!user?.email) {
        setErrMsg(t(lang, "uc.sec.noEmail"));
        return;
      }
      if (!currPass) {
        setCurrPassError(t(lang, "uc.sec.enterCurrent"));
        return;
      }
      if (!newPass || newPass.length < 6) {
        setErrMsg(t(lang, "uc.sec.shortNew"));
        return;
      }
      if (newPass !== newPass2) {
        setErrMsg(t(lang, "uc.sec.confirmMismatch"));
        return;
      }

      setBusyPwd(true);

      const auth = getAuth();
      const cred = EmailAuthProvider.credential(user.email, currPass);

      await reauthenticateWithCredential(auth.currentUser!, cred);
      await updatePassword(auth.currentUser!, newPass);

      setMsg(t(lang, "uc.sec.updatedOk"));
      setCurrPass("");
      setNewPass("");
      setNewPass2("");
      setCurrPassError(null);
    } catch (e: any) {
      const code: string = e?.code || "";
      if (code === "auth/wrong-password" || code === "auth/invalid-credential") {
        setCurrPassError(t(lang, "uc.sec.incorrectCurrent"));
      } else if (code === "auth/too-many-requests") {
        setCurrPassError(t(lang, "uc.sec.tooMany"));
      } else if (code === "auth/requires-recent-login") {
        setErrMsg(t(lang, "uc.sec.requiresRecent"));
      } else {
        setErrMsg(e?.message || t(lang, "uc.sec.updateFailed"));
      }
    } finally {
      setBusyPwd(false);
    }
  };

  return (
    <div className="container py-4">
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h1 className="h5 m-0">{t(lang, "uc.title")}</h1>
        <button className="btn btn-outline-secondary btn-sm" onClick={() => refresh()} disabled={loading}>
          {t(lang, "common.refresh")}
        </button>
      </div>

      {loading && <div className="alert alert-info">{t(lang, "common.loading")}</div>}
      {err && <div className="alert alert-danger">{t(lang, "common.errorPrefix")} {err}</div>}
      {msg && <div className="alert alert-success">{msg}</div>}
      {errMsg && <div className="alert alert-danger">{errMsg}</div>}

      {!!cust && (
        <>
          {/* PERFIL */}
          <section className="mb-4">
            <div className="card shadow-sm">
              <div className="card-header">
                <strong>{t(lang, "uc.profile.title")}</strong>
              </div>
              <div className="card-body">
                <div className="row g-3">
                  <div className="col-12 col-md-6">
                    <label className="form-label">{t(lang, "uc.profile.emailLabel")}</label>
                    <input className="form-control" value={cust.email || ""} disabled />
                  </div>
                  <div className="col-12 col-md-6">
                    <label className="form-label">{t(lang, "uc.profile.displayName")}</label>
                    <input
                      className="form-control"
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      placeholder={t(lang, "uc.profile.displayNamePh")}
                    />
                  </div>
                  <div className="col-12 col-md-6">
                    <label className="form-label">{t(lang, "uc.profile.phone")}</label>
                    <input
                      className="form-control"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      placeholder={t(lang, "uc.profile.phonePh")}
                    />
                  </div>
                </div>
              </div>
              <div className="card-footer d-flex justify-content-end">
                <button className="btn btn-primary" onClick={onSaveProfile} disabled={busyProfile}>
                  {busyProfile ? t(lang, "common.saving") : t(lang, "uc.profile.save")}
                </button>
              </div>
            </div>
          </section>

          {/* DIRECCIONES */}
          <section className="mb-4">
            <div className="card shadow-sm">
              <div className="card-header">
                <strong>{t(lang, "uc.addresses.title")}</strong>
              </div>
              <div className="card-body">
                <div className="row">
                  {/* HOME */}
                  <div className="col-12 col-lg-6">
                    <h6 className="mb-3">{t(lang, "uc.addresses.home")}</h6>
                    <div className="mb-2">
                      <label className="form-label">{t(lang, "uc.addresses.address")}</label>
                      <input
                        className="form-control"
                        value={home.line1}
                        onChange={(e) => setHome({ ...home, line1: e.target.value })}
                        placeholder={t(lang, "uc.addresses.addressHomePh")}
                      />
                    </div>
                    <div className="row g-2">
                      <div className="col-12 col-md-6">
                        <label className="form-label">{t(lang, "uc.addresses.city")}</label>
                        <input
                          className="form-control"
                          value={home.city}
                          onChange={(e) => setHome({ ...home, city: e.target.value })}
                          placeholder={t(lang, "uc.addresses.cityPh")}
                        />
                      </div>
                      <div className="col-6 col-md-3">
                        <label className="form-label">{t(lang, "uc.addresses.country")}</label>
                        <input
                          className="form-control"
                          value={home.country}
                          onChange={(e) => setHome({ ...home, country: e.target.value })}
                          placeholder={t(lang, "uc.addresses.countryPh")}
                        />
                      </div>
                      <div className="col-6 col-md-3">
                        <label className="form-label">{t(lang, "uc.addresses.zip")}</label>
                        <input
                          className="form-control"
                          value={home.zip}
                          onChange={(e) => setHome({ ...home, zip: e.target.value })}
                          placeholder={t(lang, "uc.addresses.zipPh")}
                        />
                      </div>
                    </div>
                    <div className="mt-2">
                      <label className="form-label">{t(lang, "uc.addresses.notes")}</label>
                      <textarea
                        className="form-control"
                        rows={2}
                        value={home.notes}
                        onChange={(e) => setHome({ ...home, notes: e.target.value })}
                        placeholder={t(lang, "uc.addresses.notesHomePh")}
                      />
                    </div>
                  </div>

                  {/* OFFICE */}
                  <div className="col-12 col-lg-6 mt-4 mt-lg-0">
                    <h6 className="mb-3">{t(lang, "uc.addresses.office")}</h6>
                    <div className="mb-2">
                      <label className="form-label">{t(lang, "uc.addresses.address")}</label>
                      <input
                        className="form-control"
                        value={office.line1}
                        onChange={(e) => setOffice({ ...office, line1: e.target.value })}
                        placeholder={t(lang, "uc.addresses.addressOfficePh")}
                      />
                    </div>
                    <div className="row g-2">
                      <div className="col-12 col-md-6">
                        <label className="form-label">{t(lang, "uc.addresses.city")}</label>
                        <input
                          className="form-control"
                          value={office.city}
                          onChange={(e) => setOffice({ ...office, city: e.target.value })}
                          placeholder={t(lang, "uc.addresses.cityPh")}
                        />
                      </div>
                      <div className="col-6 col-md-3">
                        <label className="form-label">{t(lang, "uc.addresses.country")}</label>
                        <input
                          className="form-control"
                          value={office.country}
                          onChange={(e) => setOffice({ ...office, country: e.target.value })}
                          placeholder={t(lang, "uc.addresses.countryPh")}
                        />
                      </div>
                      <div className="col-6 col-md-3">
                        <label className="form-label">{t(lang, "uc.addresses.zip")}</label>
                        <input
                          className="form-control"
                          value={office.zip}
                          onChange={(e) => setOffice({ ...office, zip: e.target.value })}
                          placeholder={t(lang, "uc.addresses.zipPh")}
                        />
                      </div>
                    </div>
                    <div className="mt-2">
                      <label className="form-label">{t(lang, "uc.addresses.notes")}</label>
                      <textarea
                        className="form-control"
                        rows={2}
                        value={office.notes}
                        onChange={(e) => setOffice({ ...office, notes: e.target.value })}
                        placeholder={t(lang, "uc.addresses.notesOfficePh")}
                      />
                    </div>
                  </div>
                </div>
              </div>
              <div className="card-footer d-flex justify-content-end">
                <button className="btn btn-primary" onClick={onSaveAddresses} disabled={busyAddr}>
                  {busyAddr ? t(lang, "common.saving") : t(lang, "uc.addresses.save")}
                </button>
              </div>
            </div>
          </section>

          {/* FACTURACIÓN */}
          <section className="mb-4">
            <div className="card shadow-sm">
              <div className="card-header">
                <strong>{t(lang, "uc.billing.title")}</strong>
              </div>
              <div className="card-body">
                <div className="row g-3">
                  <div className="col-12 col-md-6">
                    <label className="form-label">{t(lang, "uc.billing.name")}</label>
                    <input
                      className="form-control"
                      value={billingName}
                      onChange={(e) => setBillingName(e.target.value)}
                      placeholder={t(lang, "uc.billing.namePh")}
                    />
                  </div>
                  <div className="col-12 col-md-6">
                    <label className="form-label">{t(lang, "uc.billing.taxId")}</label>
                    <input
                      className="form-control"
                      value={billingTaxId}
                      onChange={(e) => setBillingTaxId(e.target.value)}
                      placeholder={t(lang, "uc.billing.taxIdPh")}
                    />
                  </div>
                </div>
              </div>
              <div className="card-footer d-flex justify-content-end">
                <button className="btn btn-primary" onClick={onSaveBilling} disabled={busyBilling}>
                  {busyBilling ? t(lang, "common.saving") : t(lang, "uc.billing.save")}
                </button>
              </div>
            </div>
          </section>

          {/* SEGURIDAD */}
          <section className="mb-4">
            <div className="card shadow-sm">
              <div className="card-header">
                <strong>{t(lang, "uc.sec.title")}</strong>{" "}
                <span className="text-muted small ms-2">({t(lang, "uc.sec.subtitle")})</span>
              </div>
              <div className="card-body">
                <div className="row g-3">
                  <div className="col-12 col-md-4">
                    <label className="form-label">{t(lang, "uc.sec.current")}</label>
                    <input
                      type="password"
                      className={`form-control ${currPassError ? "is-invalid" : ""}`}
                      value={currPass}
                      onChange={(e) => {
                        setCurrPass(e.target.value);
                        if (currPassError) setCurrPassError(null);
                      }}
                      placeholder="••••••••"
                      autoComplete="current-password"
                    />
                    {currPassError && <div className="invalid-feedback">{currPassError}</div>}
                  </div>
                  <div className="col-12 col-md-4">
                    <label className="form-label">{t(lang, "uc.sec.new")}</label>
                    <input
                      type="password"
                      className="form-control"
                      value={newPass}
                      onChange={(e) => setNewPass(e.target.value)}
                      placeholder="••••••••"
                      autoComplete="new-password"
                    />
                  </div>
                  <div className="col-12 col-md-4">
                    <label className="form-label">{t(lang, "uc.sec.confirm")}</label>
                    <input
                      type="password"
                      className="form-control"
                      value={newPass2}
                      onChange={(e) => setNewPass2(e.target.value)}
                      placeholder="••••••••"
                      autoComplete="new-password"
                    />
                  </div>
                </div>
              </div>
              <div className="card-footer d-flex justify-content-end">
                <button className="btn btn-outline-primary" onClick={onChangePassword} disabled={busyPwd}>
                  {busyPwd ? t(lang, "uc.sec.updating") : t(lang, "uc.sec.update")}
                </button>
              </div>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

export default function UserConfigPage() {
  return (
    <Protected>
      <UserConfigInner />
    </Protected>
  );
}
