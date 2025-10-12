// src/app/(tenant)/[tenantId]/app/auth/google/start/Client.tsx
"use client";

import { useEffect } from "react";
import { useSearchParams, useParams } from "next/navigation"; // tenancyUpdate
import { signIn } from "next-auth/react";

// tenancyUpdate: asegura que cualquier path quede bajo /{tenantId}
function toTenantPath(raw: string | null | undefined, tenantId: string) {
  const fallback = `/${tenantId}/app`;
  if (!raw) return fallback;
  try {
    const u = new URL(raw);
    raw = u.pathname + u.search + u.hash;
  } catch { /* no-op (relative) */ }
  if (raw.startsWith(`/${tenantId}/`)) return raw;
  if (raw.startsWith("/")) return `/${tenantId}${raw}`;
  return `/${tenantId}/${raw}`;
}

export default function GoogleStartClient() {
  const params = useSearchParams();
  const { tenantId } = useParams<{ tenantId: string }>(); // tenancyUpdate

  useEffect(() => {
    const requestedNext = params.get("next");
    const next = toTenantPath(requestedNext, tenantId); // tenancyUpdate

    // tenancyUpdate: callbackUrl al bridge tenant-aware
    const callbackUrl = `/${tenantId}/app/api/auth/session-bridge?next=${encodeURIComponent(next)}`;

    // Enviamos a NextAuth con callback que pasa por el bridge y termina en /{tenantId}/app (o el next)
    signIn("google", {
      callbackUrl,
      prompt: "select_account",
    });
  }, [params, tenantId]);

  return (
    <main className="container py-4" style={{ maxWidth: 520 }}>
      <h1 className="h4 mb-3">Conectando con Google…</h1>
      <div className="card p-3">
        <p className="mb-0 text-muted">Si no ves la ventana, revisa bloqueadores o recarga.</p>
      </div>
    </main>
  );
}
