// src/app/(tenant)/[tenantId]/app/auth/firebase/complete/page.tsx
import { Suspense } from "react";
import FirebaseCompleteClient from "./Client";

// ✅ Estas opciones SOLO en el archivo server (page.tsx)
export const dynamic = "force-dynamic";
export const revalidate = 0; // (o false)
// tenancyUpdate: ruta movida a /(tenant)/[tenantId]/...

// (opcional) evita cacheo de fetch en este segmento
// export const fetchCache = "default-no-store";

export default function Page() {
  // Suspense requerido para que el hijo (Client) use useSearchParams
  return (
    <Suspense fallback={null}>
      <FirebaseCompleteClient />
    </Suspense>
  );
}
