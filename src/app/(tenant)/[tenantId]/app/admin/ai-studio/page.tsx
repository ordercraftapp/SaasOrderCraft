/* src/app/(tenant)/[tenantId]/app/admin/ai-studio/page.tsx */
"use client";

import { useEffect, useRef, useState, useMemo } from "react";
import Protected from "@/app/(tenant)/[tenantId]/components/Protected";
import AdminOnly from "@/app/(tenant)/[tenantId]/components/AdminOnly";
import "@/lib/firebase/client";
import { getFirestore, addDoc, serverTimestamp } from "firebase/firestore";
import { getAuth, onAuthStateChanged, User } from "firebase/auth";
import TurnstileWidget, { TurnstileWidgetHandle } from "@/app/(tenant)/[tenantId]/components/TurnstileWidget";
import ToolGate from "@/components/ToolGate";
import { useTenantId } from "@/lib/tenant/context";
import { tCol } from "@/lib/db";

/** 🔤 i18n */
import { t as translate } from "@/lib/i18n/t";
import { useTenantSettings } from "@/lib/settings/hooks";

const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";

type NameItem = { name: string };
type NamesPayload = { items: NameItem[] };

type CopyItem = { name: string; description: string; seoTitle: string; keywords: string[] };
type CopyPayload = { items: CopyItem[] };

type ImagePromptItem = { name: string; imagePrompt: string };
type ImagePromptsPayload = { items: ImagePromptItem[] };

function InputHelp({ text }: { text: string }) {
  return <div className="form-text">{text}</div>;
}

export default function AIStudioPage() {
  const db = getFirestore();
  const tenantId = useTenantId(); // ✅ tenant scopiado para rutas y Firestore

  // Feature flag (ON/OFF)
  const [flagEnabled, setFlagEnabled] = useState<boolean>(true);

  // Auth ready
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<User | null>(null);

  // CAPTCHA
  const [captchaToken, setCaptchaToken] = useState<string>("");
  const tRef = useRef<TurnstileWidgetHandle | null>(null);

  // Form state
  const [language, setLanguage] = useState<"es" | "en">("es");
  const [category, setCategory] = useState("Desayunos");
  const [cuisine, setCuisine] = useState("Latinoamericana");
  const [tone, setTone] = useState("family-friendly");
  const [audience, setAudience] = useState("familias");
  const [baseIngredients, setBaseIngredients] = useState("huevos, tocino, papas");
  const [avoidAllergens, setAvoidAllergens] = useState("gluten");
  const [count, setCount] = useState(6);
  const [seoKeywords, setSeoKeywords] = useState("desayunos, restaurante, Guatemala, familia, económico");

  // Results
  const [names, setNames] = useState<NameItem[]>([]);
  const [copy, setCopy] = useState<CopyItem[]>([]);
  const [imgPrompts, setImgPrompts] = useState<ImagePromptItem[]>([]);
  const [selectedName, setSelectedName] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // 🔤 idioma (igual patrón que kitchen/waiter)
  const { settings } = useTenantSettings();
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

  // Helper: asegura un tenantId (para evitar strings en rojo/undefined)
  const requireTid = () => {
    if (!tenantId) throw new Error("Tenant no resuelto");
    return tenantId;
  };

  // --- Esperar a que Auth esté listo (evita 401 por token vacío) ---
  useEffect(() => {
    const auth = getAuth();
    const unsub = onAuthStateChanged(auth, async (u) => {
      setUser(u);
      setAuthReady(true);
    });
    return () => unsub();
  }, []);

  // --- Cargar flag SOLO cuando Auth + tenant están listos ---
  useEffect(() => {
    (async () => {
      if (!authReady || !user || !tenantId) return;
      try {
        const idToken = await user.getIdToken(/* forceRefresh */ true);
        const url = `/${tenantId}/app/api/admin/ai-studio/flag`;
        const r = await fetch(url, {
          headers: { authorization: `Bearer ${idToken}` },
        });
        const text = await r.text();
        let j: any;
        try {
          j = JSON.parse(text);
        } catch {
          throw new Error(text.slice(0, 180));
        }
        if (j?.ok) setFlagEnabled(!!j.data?.enabled);
        else throw new Error(j?.error || "Flag read failed");
      } catch (e: any) {
        console.error("Flag load error:", e?.message || e);
      }
    })();
  }, [authReady, user, tenantId]);

  async function toggleFlag() {
    try {
      if (!user) throw new Error("No user");
      const tid = requireTid();
      const idToken = await user.getIdToken(true);
      const url = `/${tid}/app/api/admin/ai-studio/flag`;
      const r = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ enabled: !flagEnabled }),
      });
      const j = await r.json();
      if (j.ok) setFlagEnabled(!!j.data.enabled);
      else throw new Error(j?.error || "Toggle failed");
    } catch (e: any) {
      setErr(e?.message || "Failed to toggle feature");
    }
  }

  // --- Captcha helpers ---
  async function getFreshCaptchaToken(maxMs = 2500): Promise<string> {
    const started = Date.now();
    // intenta leer el token actual del widget
    let token = tRef.current?.getToken() || "";
    if (token) return token;

    // resetea y espera a que emita un token
    tRef.current?.reset();
    while (!token && Date.now() - started < maxMs) {
      await new Promise((r) => setTimeout(r, 200));
      token = tRef.current?.getToken() || "";
    }
    return token;
  }

  // --- callAPI: auth + captcha + header x-tenant-id; muestra errores reales ---
  async function callAPI<T>(url: string, payload: any, tid?: string): Promise<T> {
    setBusy(true);
    setErr(null);
    try {
      if (!authReady || !user) throw new Error(tt("admin.aistudio.err.authNotReady", "Auth not ready"));
      let idToken = await user.getIdToken(/* forceRefresh */ false);

      let token = await getFreshCaptchaToken();
      if (!token) {
        tRef.current?.reset();
        token = await getFreshCaptchaToken();
      }

      let r = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          authorization: `Bearer ${idToken}`,
          "x-captcha-token": token || "",
          "x-tenant-id": tid || "",
          "x-debug": "1", // ⬅️ activa respuesta detallada desde el server
        },
        body: JSON.stringify(payload),
      });

      // si 401/403, refrescar auth + captcha y reintentar UNA vez
      if (r.status === 401 || r.status === 403) {
        idToken = await user.getIdToken(true);
        tRef.current?.reset();
        const token2 = await getFreshCaptchaToken();
        r = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            authorization: `Bearer ${idToken}`,
            "x-captcha-token": token2 || "",
            ...(tid ? { "x-tenant-id": tid } : {}),
          },
          body: JSON.stringify(payload),
        });
      }

      const text = await r.text();
      console.warn("[AIStudio callAPI] status=", r.status, "url=", url);
if (text) console.warn("[AIStudio callAPI] raw body:", text); // ⬅️ verás step+detail si viene 500/4xx
      let j: any;
      try {
        j = JSON.parse(text);
      } catch {
        // Muestra respuesta cruda si no es JSON (útil para distinguir captcha vs auth)
        throw new Error(
          tt("admin.aistudio.err.nonJson", "Non-JSON response ({code}): {body}", {
            code: String(r.status),
            body: text.slice(0, 200),
          })
        );
      }
      if (!j.ok)
        throw new Error(
          j.error || tt("admin.aistudio.err.requestFailed", "Request failed ({code})", { code: String(r.status) })
        );
      return j.data as T;
    } finally {
      setBusy(false);
    }
  }

  async function onGenerateNames() {
    try {
      const tid = requireTid();
      const payload = {
        category,
        cuisine,
        tone,
        audience,
        baseIngredients: splitCsv(baseIngredients),
        avoidAllergens: splitCsv(avoidAllergens),
        count,
        language,
      };
      const data = await callAPI<NamesPayload>(`/${tid}/app/api/ai/generate-names`, payload, tid);
      setNames(data.items || []);
      setSelectedName(null);
      setCopy([]);
      setImgPrompts([]);
    } catch (e: any) {
      setErr(e.message);
    }
  }

  // Descripción + SEO SOLO para el nombre seleccionado
  async function onGenerateCopySelected() {
    if (!selectedName) {
      setErr(tt("admin.aistudio.err.pickNameFirst", "Select a name first"));
      return;
    }
    try {
      const tid = requireTid();
      const payload = {
        names: [selectedName],
        tone,
        language,
        seoKeywords: splitCsv(seoKeywords),
      };
      const data = await callAPI<CopyPayload>(`/${tid}/app/api/ai/generate-copy`, payload, tid);
      setCopy(data.items || []);
      setImgPrompts([]);
    } catch (e: any) {
      setErr(e.message);
    }
  }

  // Prompt de imagen SOLO para el nombre seleccionado
  async function onGenerateImgPromptSelected() {
    if (!selectedName) {
      setErr(tt("admin.aistudio.err.pickNameFirst", "Select a name first"));
      return;
    }
    try {
      const tid = requireTid();
      const payload = { items: [{ name: selectedName }], language };
      const data = await callAPI<ImagePromptsPayload>(`/${tid}/app/api/ai/generate-image-prompts`, payload, tid);
      setImgPrompts(data.items || []);
    } catch (e: any) {
      setErr(e.message);
    }
  }

  async function saveDraft() {
    try {
      const tid = requireTid();
      const docData = {
        type: "ai_studio_batch",
        createdAt: serverTimestamp(),
        inputs: {
          language,
          category,
          cuisine,
          tone,
          audience,
          baseIngredients,
          avoidAllergens,
          count,
          seoKeywords,
        },
        outputs: {
          names,
          copy,
          imgPrompts,
        },
        status: "draft",
        tenantId: tid, // ✅ siempre escribir tenantId
      };
      // tenants/{tenantId}/ai_drafts (scopiado)
      await addDoc(tCol("ai_drafts", tid), docData);
      alert(tt("admin.aistudio.saved", "Saved to ai_drafts ✅"));
    } catch (e: any) {
      setErr(e.message || "Save failed");
    }
  }

  const controlsDisabled = busy || !flagEnabled || !authReady || !user;

  return (
    <Protected>
      <AdminOnly>
        {/* ✅ Gate por plan: AI Studio solo en plan Full */}
        <ToolGate feature="aiStudio">
          <main className="container py-4">
            <div className="d-flex align-items-center justify-content-between mb-3">
              <h1 className="h3 m-0">{tt("admin.aistudio.title", "AI Studio — Dish Generator")}</h1>
              <div className="d-flex align-items-center">
                <div className="form-check form-switch me-3">
                  <input
                    className="form-check-input"
                    type="checkbox"
                    role="switch"
                    id="aiStudioToggle"
                    checked={flagEnabled}
                    onChange={toggleFlag}
                    disabled={!authReady || !user}
                  />
                  <label className="form-check-label" htmlFor="aiStudioToggle">
                    {tt("admin.aistudio.toggle", "AI Studio {state}", { state: flagEnabled ? "ON" : "OFF" })}
                  </label>
                </div>

                <button className="btn btn-outline-secondary me-2" onClick={saveDraft} disabled={controlsDisabled}>
                  {tt("admin.aistudio.saveDraft", "Save Draft")}
                </button>
                <button className="btn btn-primary" onClick={onGenerateNames} disabled={controlsDisabled}>
                  {tt("admin.aistudio.generateNames", "Generate Names")}
                </button>
              </div>
            </div>

            <div className="row g-3">
              <div className="col-md-6">
                <div className="card">
                  <div className="card-body">
                    <h5 className="card-title">{tt("admin.aistudio.input", "Input")}</h5>

                    <div className="row g-3">
                      <div className="col-4">
                        <label className="form-label">{tt("admin.aistudio.lang", "Language")}</label>
                        <select className="form-select" value={language} onChange={(e) => setLanguage(e.target.value as any)}>
                          <option value="es">{tt("admin.aistudio.lang.es", "Spanish")}</option>
                          <option value="en">{tt("admin.aistudio.lang.en", "English")}</option>
                        </select>
                        <InputHelp text={tt("admin.aistudio.langHelp", "Language for generated text")} />
                      </div>
                      <div className="col-4">
                        <label className="form-label">{tt("admin.aistudio.category", "Category")}</label>
                        <input className="form-control" value={category} onChange={(e) => setCategory(e.target.value)} />
                      </div>
                      <div className="col-4">
                        <label className="form-label">{tt("admin.aistudio.cuisine", "Cuisine")}</label>
                        <input className="form-control" value={cuisine} onChange={(e) => setCuisine(e.target.value)} />
                      </div>

                      <div className="col-6">
                        <label className="form-label">{tt("admin.aistudio.tone", "Tone")}</label>
                        <input className="form-control" value={tone} onChange={(e) => setTone(e.target.value)} />
                        <InputHelp text={tt("admin.aistudio.toneHelp", 'e.g., "family-friendly", "gourmet", "fun", "corporate"')} />
                      </div>
                      <div className="col-6">
                        <label className="form-label">{tt("admin.aistudio.audience", "Audience")}</label>
                        <input className="form-control" value={audience} onChange={(e) => setAudience(e.target.value)} />
                      </div>

                      <div className="col-6">
                        <label className="form-label">{tt("admin.aistudio.baseIng", "Base ingredients (CSV)")}</label>
                        <input className="form-control" value={baseIngredients} onChange={(e) => setBaseIngredients(e.target.value)} />
                      </div>
                      <div className="col-6">
                        <label className="form-label">{tt("admin.aistudio.avoidAll", "Avoid allergens (CSV)")}</label>
                        <input className="form-control" value={avoidAllergens} onChange={(e) => setAvoidAllergens(e.target.value)} />
                      </div>

                      <div className="col-8">
                        <label className="form-label">{tt("admin.aistudio.seoKeywords", "SEO keywords (CSV)")}</label>
                        <input className="form-control" value={seoKeywords} onChange={(e) => setSeoKeywords(e.target.value)} />
                      </div>
                      <div className="col-4">
                        <label className="form-label">{tt("admin.aistudio.count", "Count")}</label>
                        <input
                          type="number"
                          min={1}
                          max={20}
                          className="form-control"
                          value={count}
                          onChange={(e) => setCount(parseInt(e.target.value || "1"))}
                        />
                      </div>
                    </div>

                    {/* CAPTCHA arriba de los botones */}
                    <div className="mt-3">
                      {TURNSTILE_SITE_KEY ? (
                        <TurnstileWidget ref={tRef} siteKey={TURNSTILE_SITE_KEY} onToken={setCaptchaToken} />
                      ) : (
                        <div className="alert alert-warning py-2">
                          {tt("admin.aistudio.turnstileMissing", "Missing")} <code>NEXT_PUBLIC_TURNSTILE_SITE_KEY</code>{" "}
                          {tt("admin.aistudio.envVar", "env var.")}
                        </div>
                      )}
                    </div>

                    <div className="mt-3 d-flex flex-wrap gap-2">
                      <button
                        className="btn btn-outline-primary"
                        onClick={onGenerateCopySelected}
                        disabled={controlsDisabled || !selectedName}
                      >
                        {tt("admin.aistudio.genDescSelected", "Generate Description (selected)")}
                      </button>
                      <button
                        className="btn btn-outline-secondary"
                        onClick={onGenerateImgPromptSelected}
                        disabled={controlsDisabled || !selectedName}
                      >
                        {tt("admin.aistudio.genImgSelected", "Generate Image Prompt (selected)")}
                      </button>
                    </div>

                    {err && <div className="alert alert-danger mt-3">{err}</div>}
                  </div>
                </div>
              </div>

              <div className="col-md-6">
                <div className="card h-100">
                  <div className="card-body">
                    <h5 className="card-title">{tt("admin.aistudio.preview", "Preview")}</h5>

                    {/* Names con selección */}
                    {names.length > 0 && (
                      <>
                        <h6 className="mt-2">{tt("admin.aistudio.dishNames", "Dish Names")}</h6>
                        <ul className="list-group mb-3">
                          {names.map((n, i) => (
                            <li
                              key={i}
                              className={`list-group-item d-flex justify-content-between align-items-center ${
                                selectedName === n.name ? "active" : ""
                              }`}
                              style={{ cursor: "pointer" }}
                              onClick={() => setSelectedName(n.name)}
                            >
                              <div className="d-flex align-items-center gap-2">
                                <input
                                  type="radio"
                                  name="selectedDish"
                                  checked={selectedName === n.name}
                                  onChange={() => setSelectedName(n.name)}
                                />
                                <span>{n.name}</span>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </>
                    )}

                    {/* Copy (del seleccionado) */}
                    {copy.length > 0 && (
                      <>
                        <h6>{tt("admin.aistudio.copy", "Copy (Description + SEO)")}</h6>
                        <div className="d-flex flex-column gap-2">
                          {copy.map((c, i) => (
                            <div key={i} className="border rounded p-2">
                              <div className="fw-semibold">{c.name}</div>
                              <div className="text-muted small my-1">{c.description}</div>
                              <div>
                                <span className="badge text-bg-secondary me-2">SEO</span>
                                {c.seoTitle}
                              </div>
                              <div className="mt-1">
                                {c.keywords.map((k, kidx) => (
                                  <span key={kidx} className="badge text-bg-light me-1">
                                    {k}
                                  </span>
                                ))}
                              </div>
                            </div>
                          ))}
                        </div>
                      </>
                    )}

                    {/* Image Prompt (del seleccionado) */}
                    {imgPrompts.length > 0 && (
                      <>
                        <h6 className="mt-3">{tt("admin.aistudio.imagePrompt", "Image Prompt")}</h6>
                        <div className="d-flex flex-column gap-2">
                          {imgPrompts.map((p, i) => (
                            <div key={i} className="border rounded p-2">
                              <div className="fw-semibold">{p.name}</div>
                              <code className="small d-block mt-1" style={{ whiteSpace: "pre-wrap" }}>
                                {p.imagePrompt}
                              </code>
                            </div>
                          ))}
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </main>
        </ToolGate>
      </AdminOnly>
    </Protected>
  );
}

function splitCsv(s: string): string[] {
  return s
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}
