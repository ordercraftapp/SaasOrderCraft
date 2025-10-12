// src/app/(tenant)/[tenantId]/app/auth/firebase/complete/Client.tsx
"use client";

import { useEffect, useRef } from "react";
import { useRouter, useSearchParams, useParams } from "next/navigation";
import { signInWithCustomToken } from "firebase/auth";
import { auth } from "@/lib/firebase/client";

// tenancyUpdate: normaliza un path para que quede dentro de /{tenantId}
function toTenantPath(raw: string | null | undefined, tenantId: string) {
  const fallback = `/${tenantId}/app`;
  if (!raw) return fallback;

  // Si viene absoluta con mismo host, quédate con su pathname
  try {
    const u = new URL(raw);
    raw = u.pathname + u.search + u.hash;
  } catch {
    // no es URL absoluta, está bien
  }

  // Evita duplicar prefijo
  if (raw.startsWith(`/${tenantId}/`)) return raw;

  // Si el path es relativo (ej. "/app" o "app"), asegura prefijo
  if (raw.startsWith("/")) return `/${tenantId}${raw}`;
  return `/${tenantId}/${raw}`;
}

export default function FirebaseCompleteClient() {
  const router = useRouter();
  const params = useSearchParams();
  const { tenantId } = useParams<{ tenantId: string }>(); // tenancyUpdate
  const onceRef = useRef(false);

  useEffect(() => {
    if (onceRef.current) return;
    onceRef.current = true;

    // tenancyUpdate: default dentro del tenant
    const requestedNext = params.get("next");
    const next = toTenantPath(requestedNext, tenantId);

    (async () => {
      try {
        // 1) Custom token desde NextAuth (API tenant-aware)
        const res = await fetch(`/${tenantId}/app/api/auth/firebase-token`, { // tenancyUpdate
          credentials: "include",
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`TOKEN_HTTP_${res.status}`);
        const { token } = await res.json();

        // 2) Login Firebase con custom token
        await signInWithCustomToken(auth, token);

        // 3) Cookie de rol y destino final (API tenant-aware)
        try {
          const idToken = await auth.currentUser!.getIdToken(true);
          const r2 = await fetch(`/${tenantId}/app/api/auth/role-cookie`, { // tenancyUpdate
            method: "GET",
            headers: { Authorization: `Bearer ${idToken}` },
            cache: "no-store",
          });
          if (r2.ok) {
            const { target } = await r2.json();
            const targetPath = toTenantPath(target, tenantId); // tenancyUpdate
            router.replace(targetPath || next);
            return;
          }
        } catch {
          /* noop */
        }

        // 4) Fallback dentro del tenant
        router.replace(next);
      } catch {
        // tenancyUpdate: login del tenant con next normalizado
        const loginUrl = `/${tenantId}/login?next=${encodeURIComponent(next)}`;
        router.replace(loginUrl);
      }
    })();
  }, [params, router, tenantId]);

  return null; // sin UI
}
