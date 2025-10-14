"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { createUserWithEmailAndPassword, updateProfile } from "firebase/auth";
import { auth } from "@/lib/firebase/client";
import { useRouter, useParams } from "next/navigation";
import { useAuth } from "@/app/providers";

// 🔤 i18n
import { t as translate } from "@/lib/i18n/t";
import { useTenantSettings } from "@/lib/settings/hooks";

// ✅ Turnstile
import TurnstileWidget, { TurnstileWidgetHandle } from "@/app/(tenant)/[tenantId]/components/TurnstileWidget";
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "";

export default function AccountsRegisterPage() {
  const router = useRouter();
  // 👇 usa el nombre correcto del segmento
  const params = useParams<{ tenantId: string }>();
  const tenantId = (params?.tenantId || "").trim();

  const appBase = tenantId ? `/${tenantId}/app` : "/app";
  const apiBase = appBase; // APIs viven en /{tenantId}/app/api/...
  const loginHref = tenantId ? `/${tenantId}/login` : "/login";

  const { user, loading } = useAuth();

  // Idioma
  const { settings } = useTenantSettings();
  const initialLang = (settings as any)?.language;
  const [lang, setLang] = useState<string | undefined>(initialLang);
  useEffect(() => {
    try {
      const ls = localStorage.getItem("tenant.language");
      if (ls && ls !== initialLang) setLang(ls);
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const tt = (key: string, fallback: string, vars?: Record<string, unknown>) => {
    const s = translate(lang, key, vars);
    return s === key ? fallback : s;
  };

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [pass1, setPass1] = useState("");
  const [pass2, setPass2] = useState("");

  // Required acknowledgement + optional marketing opt-in
  const [ackMarketing, setAckMarketing] = useState(false);
  const [marketingOptIn, setMarketingOptIn] = useState(false);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  // ✅ CAPTCHA
  const [captchaToken, setCaptchaToken] = useState<string>("");
  const tRef = useRef<TurnstileWidgetHandle | null>(null);

  useEffect(() => {
    if (!loading && user) router.replace(appBase);
  }, [loading, user, router, appBase]);

  async function getFreshCaptchaToken(maxMs = 2500): Promise<string> {
    const started = Date.now();
    let token = tRef.current?.getToken() || "";
    if (token) return token;
    tRef.current?.reset();
    while (!token && Date.now() - started < maxMs) {
      await new Promise((r) => setTimeout(r, 200));
      token = tRef.current?.getToken() || "";
    }
    return token;
  }

  function prettyFirebaseError(e: any): string {
    const code = String(e?.code || "").replace(/^auth\//, "");
    const msg = String(e?.message || "");
    if (code) return code;
    if (/Failed to fetch/i.test(msg)) return "network-request-failed";
    if (/DOMAIN_NOT_AUTHORIZED/i.test(msg)) return "domain-not-authorized";
    return msg || "unknown-error";
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr(null);

    if (!ackMarketing) {
      setErr(tt("account.err.ack", "Please acknowledge the marketing notice to continue."));
      return;
    }
    if (fullName.trim().length < 2) {
      setErr(tt("account.err.name", "Please enter your full name."));
      return;
    }
    if (!email.trim() || !email.includes("@")) {
      setErr(tt("account.err.email", "Please enter a valid email address."));
      return;
    }
    if (pass1 !== pass2) {
      setErr(tt("account.err.pass.match", "Passwords do not match."));
      return;
    }
    if (pass1.length < 6) {
      setErr(tt("account.err.pass.min", "Password must be at least 6 characters long."));
      return;
    }

    // ✅ Turnstile
    let token = await getFreshCaptchaToken();
    if (!token) {
      tRef.current?.reset();
      token = await getFreshCaptchaToken();
    }
    if (!token) {
      setErr(tt("account.err.captcha", "Please complete the CAPTCHA to continue."));
      return;
    }

    setBusy(true);
    try {
      // 1) Firebase signUp
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), pass1);
      await updateProfile(cred.user, { displayName: fullName.trim() });
      const idToken = await cred.user.getIdToken(true);

      // 2) Bootstrap GET (idempotente) para inicializar customers/{uid} bajo el tenant
      //    Mandamos ambos headers por si el server lee uno u otro.
      try {
        const gRes = await fetch(`${apiBase}/api/customers/me`, {
          method: "GET",
          headers: {
            Authorization: `Bearer ${idToken}`,
            "x-tenant": tenantId || "",
            "x-tenant-id": tenantId || "",
          },
          cache: "no-store",
        });
        if (!gRes.ok) {
          console.warn("[customers/me GET] non-OK:", gRes.status, await gRes.text().catch(() => ""));
        }
      } catch (gErr) {
        console.warn("[customers/me GET] failed:", gErr);
      }

      // 3) PATCH perfil con PUT (displayName + marketingOptIn)
      const putRes = await fetch(`${apiBase}/api/customers/me`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${idToken}`,
          "content-type": "application/json",
          "x-turnstile-token": token,
          "x-tenant": tenantId || "",
          "x-tenant-id": tenantId || "",
        },
        body: JSON.stringify({
          displayName: fullName.trim(),
          marketingOptIn,
        }),
      });

      if (!putRes.ok) {
        const text = await putRes.text().catch(() => "");
        // Si el server respondiera 404/405 por alguna razón, no bloqueamos el flujo del usuario:
        console.warn("[customers/me PUT] non-OK:", putRes.status, text);
        setErr(`Profile bootstrap failed (${putRes.status}).`);
      }

      // 4) Welcome (idempotente)
      try {
        const wRes = await fetch(`${apiBase}/api/tx/welcome`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${idToken}`,
            "content-type": "application/json",
            "x-tenant": tenantId || "",
            "x-tenant-id": tenantId || "",
          },
        });
        if (!wRes.ok) {
          console.warn("[welcome POST] non-OK:", wRes.status, await wRes.text().catch(() => ""));
        }
      } catch (er) {
        console.warn("[welcome POST] failed:", er);
      }

      router.replace(appBase);
    } catch (e: any) {
      const nice = prettyFirebaseError(e);
      console.error("[account/create] signup failed:", e);
      setErr(tt("account.err.createFail", "The account could not be created. Please try again.") + ` (${nice})`);
      try { tRef.current?.reset(); } catch {}
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="container py-4" style={{ maxWidth: 520 }}>
      <h1 className="h3 mb-3 text-center">{tt("account.title", "Create account")}</h1>

      <form onSubmit={onSubmit} className="card p-3 border-0 shadow-sm">
        {/* nombre */}
        <div className="mb-3">
          <label className="form-label">{tt("account.fullName.label", "Full name")}</label>
          <input
            className="form-control"
            type="text"
            placeholder={tt("account.fullName.placeholder", "John Doe")}
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
            disabled={busy}
          />
        </div>

        {/* email */}
        <div className="mb-3">
          <label className="form-label">{tt("account.email.label", "Email")}</label>
          <input
            className="form-control"
            type="email"
            autoComplete="email"
            placeholder={tt("account.email.placeholder", "you@example.com")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            disabled={busy}
          />
        </div>

        {/* password */}
        <div className="mb-3">
          <label className="form-label">{tt("account.password.label", "Password")}</label>
          <input
            className="form-control"
            type="password"
            autoComplete="new-password"
            placeholder={tt("account.password.placeholder", "Minimum 6 characters")}
            value={pass1}
            onChange={(e) => setPass1(e.target.value)}
            required
            disabled={busy}
            minLength={6}
          />
        </div>

        {/* confirm */}
        <div className="mb-3">
          <label className="form-label">{tt("account.confirm.label", "Confirm password")}</label>
          <input
            className="form-control"
            type="password"
            autoComplete="new-password"
            placeholder={tt("account.confirm.placeholder", "Re-enter your password")}
            value={pass2}
            onChange={(e) => setPass2(e.target.value)}
            required
            disabled={busy}
            minLength={6}
          />
        </div>

        {/* avisos */}
        <div className="form-check mb-2">
          <input
            className="form-check-input"
            type="checkbox"
            id="ackMarketing"
            checked={ackMarketing}
            onChange={(e) => setAckMarketing(e.target.checked)}
            disabled={busy}
            required
          />
          <label className="form-check-label" htmlFor="ackMarketing">
            {tt("account.ack.label", "I understand that my email may be used for marketing communications if I opt in.")}
          </label>
        </div>

        {/* opt-in */}
        <div className="form-check form-switch mb-1">
          <input
            className="form-check-input"
            type="checkbox"
            id="optInSwitch"
            checked={marketingOptIn}
            onChange={(e) => setMarketingOptIn(e.target.checked)}
            disabled={busy}
          />
          <label className="form-check-label" htmlFor="optInSwitch">
            {tt("account.optin.label", "Send me promotions and special offers.")}
          </label>
        </div>
        <p className="text-muted small mb-3">
          {tt("account.optin.note", "You can unsubscribe at any time using the links in our emails.")}
        </p>

        {/* Turnstile */}
        <div className="mb-3">
          {TURNSTILE_SITE_KEY ? (
            <TurnstileWidget ref={tRef} siteKey={TURNSTILE_SITE_KEY} onToken={setCaptchaToken} />
          ) : (
            <div className="alert alert-warning py-2">
              Missing <code>NEXT_PUBLIC_TURNSTILE_SITE_KEY</code> env var.
            </div>
          )}
        </div>

        <button className="btn btn-success w-100" disabled={busy}>
          {busy ? tt("account.submit.creating", "Creating...") : tt("account.submit.create", "Create account")}
        </button>

        {err && <p className="text-danger mt-3 mb-0">{err}</p>}
      </form>

      <p className="text-center mt-3 mb-0">
        {tt("account.footer.have", "Already have an account?")}{" "}
        <a href={loginHref} className="link-primary">{tt("account.footer.signin", "Sign in")}</a>
      </p>
    </main>
  );
}
