// src/app/(tenant)/[tenantId]/app/join/page.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";

type Phase = "idle" | "accepting" | "accepted" | "error" | "missing";

export default function JoinPage() {
  const router = useRouter();
  const { tenantId } = useParams<{ tenantId: string }>();
  const params = useSearchParams();

  const token = useMemo(() => (params.get("token") || "").trim(), [params]);
  const loginHref = `/${tenantId}/app/login`;
  const homeHref = `/${tenantId}/app`;

  const [phase, setPhase] = useState<Phase>("idle");
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    let cancelled = false;

    async function accept() {
      if (!tenantId) return;
      if (!token) {
        setPhase("missing");
        setMessage("Missing or invalid invitation token.");
        return;
      }

      setPhase("accepting");
      setMessage("");

      try {
        const resp = await fetch(`/${tenantId}/app/api/members/accept`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token }),
          cache: "no-store",
        });

        const data = await resp.json().catch(() => ({}));

        if (!resp.ok) {
          const msg =
            data?.error ||
            (resp.status === 404
              ? "Invitation not found or already used."
              : resp.status === 410
              ? "This invitation has expired."
              : "Could not accept the invitation.");
          if (!cancelled) {
            setPhase("error");
            setMessage(msg);
          }
          return;
        }

        // Éxito: el miembro fue creado/actualizado en Firestore.
        if (!cancelled) {
          setPhase("accepted");
          setMessage("Invitation accepted! You can sign in now.");
          // Redirige suavemente al login del tenant después de un breve toque
          setTimeout(() => {
            router.replace(loginHref);
          }, 1800);
        }
      } catch {
        if (!cancelled) {
          setPhase("error");
          setMessage("Network error. Please try again.");
        }
      }
    }

    accept();
    return () => {
      cancelled = true;
    };
  }, [tenantId, token, router, loginHref]);

  return (
    <main className="container py-4" style={{ maxWidth: 520 }}>
      <h1 className="h4 mb-3 text-center">Join workspace</h1>

      <div className="card border-0 shadow-sm">
        <div className="card-body">
          {phase === "accepting" && (
            <>
              <div className="d-flex align-items-center gap-2">
                <div className="spinner-border spinner-border-sm" role="status" />
                <strong>Accepting your invitation…</strong>
              </div>
              <p className="text-muted mb-0 mt-2">Please wait a moment.</p>
            </>
          )}

          {phase === "accepted" && (
            <>
              <div className="alert alert-success mb-2">
                <strong>{message || "Invitation accepted!"}</strong>
              </div>
              <p className="mb-3">You’ll be redirected to the login page.</p>
              <a href={loginHref} className="btn btn-primary w-100">Go to Login</a>
            </>
          )}

          {phase === "missing" && (
            <>
              <div className="alert alert-warning mb-2">
                <strong>No invitation token found.</strong>
              </div>
              <p className="mb-3">Please use the invitation link you received via email.</p>
              <a href={homeHref} className="btn btn-outline-secondary w-100">Back to Home</a>
            </>
          )}

          {phase === "error" && (
            <>
              <div className="alert alert-danger mb-2">
                <strong>{message || "Could not accept the invitation."}</strong>
              </div>
              <p className="mb-3">
                If the problem persists, ask the administrator to send a new invite.
              </p>
              <div className="d-flex gap-2">
                <a href={loginHref} className="btn btn-outline-secondary w-100">Go to Login</a>
                <a href={homeHref} className="btn btn-secondary w-100">Back to Home</a>
              </div>
            </>
          )}

          {phase === "idle" && (
            <>
              <div className="d-flex align-items-center gap-2">
                <div className="spinner-border spinner-border-sm" role="status" />
                <strong>Preparing…</strong>
              </div>
              <p className="text-muted mb-0 mt-2">Almost there.</p>
            </>
          )}
        </div>
      </div>

      <p className="text-center text-muted small mt-3 mb-0">
        Tenant: <code>{tenantId}</code>
      </p>
    </main>
  );
}
