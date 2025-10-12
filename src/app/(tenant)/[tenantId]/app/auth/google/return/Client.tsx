// src/app/(tenant)/[tenantId]/app/auth/google/return/Client.tsx
"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams, useParams } from "next/navigation"; // tenancyUpdate
import { getRedirectResult, AuthError } from "firebase/auth";
import { auth, ensureLocalPersistence } from "@/lib/firebase/client";
import { useAuth } from "@/app/providers";

const NEXT_KEY = "login_next_after_google";

// tenancyUpdate: normaliza un path para que quede dentro de /{tenantId}
function toTenantPath(raw: string | null | undefined, tenantId: string) {
  const fallback = `/${tenantId}/app`;
  if (!raw) return fallback;

  // Si viene absoluta con mismo host, quédate con su pathname
  try {
    const u = new URL(raw);
    raw = u.pathname + u.search + u.hash;
  } catch {
    // no es URL absoluta, ok
  }

  // Evita duplicar prefijo
  if (raw.startsWith(`/${tenantId}/`)) return raw;

  // Si el path es relativo ("/app" o "app"), asegura prefijo
  if (raw.startsWith("/")) return `/${tenantId}${raw}`;
  return `/${tenantId}/${raw}`;
}

export default function GoogleReturnClient() {
  const router = useRouter();
  const params = useSearchParams();
  const { tenantId } = useParams<{ tenantId: string }>(); // tenancyUpdate
  const { user: ctxUser, loading } = useAuth();

  const [phase, setPhase] = useState("idle");
  const [code, setCode] = useState<string | null>(null);
  const processedRef = useRef(false);

  useEffect(() => {
    if (processedRef.current) return;
    processedRef.current = true;

    (async () => {
      try {
        // 👇 Asegura persistencia LOCAL ANTES de leer el resultado
        setPhase("ensuring_persistence");
        await ensureLocalPersistence();

        setPhase("checking_redirect_result");
        const res = await getRedirectResult(auth);

        const requestedNext =
          sessionStorage.getItem(NEXT_KEY) || params.get("next") || null; // tenancyUpdate
        const next = toTenantPath(requestedNext, tenantId); // tenancyUpdate
        sessionStorage.removeItem(NEXT_KEY);

        if (res?.user) {
          setPhase("redirect_result_has_user");
          router.replace(next); // tenancyUpdate
          return;
        }

        if (!loading && (ctxUser || auth.currentUser)) {
          setPhase("context_has_user");
          router.replace(next); // tenancyUpdate
          return;
        }

        setPhase("redirect_result_empty");
      } catch (e: any) {
        setCode((e as AuthError)?.code ?? null);
        setPhase("redirect_result_error");
      }
    })();
  }, [router, params, loading, ctxUser, tenantId]); // tenancyUpdate

  // tenancyUpdate: enlaces con prefijo del tenant
  const loginHref = `/${tenantId}/login`;
  const retryHref = `/${tenantId}/auth/google/start`;

  return (
    <main className="container py-4" style={{ maxWidth: 520 }}>
      <h1 className="h4 mb-3">Procesando inicio de sesión…</h1>
      <div className="card p-3">
        <div>Fase: <code>{phase}</code></div>
        {code && (
          <div className="mt-2">
            Código: <code>{code}</code>
          </div>
        )}
        <div className="mt-3 d-flex gap-2">
          <a href={loginHref} className="btn btn-outline-secondary">Volver al login</a>
          <a href={retryHref} className="btn btn-secondary">Intentar de nuevo</a>
        </div>
      </div>
    </main>
  );
}
