// src/app/(tenant)/[tenantId]/app/auth/google/start/page.tsx
import { Suspense } from "react";
import GoogleStartClient from "./Client";

export const dynamic = "force-dynamic";
export const revalidate = 0;
// tenancyUpdate: ruta correcta bajo /(tenant)/[tenantId]/...

export default function Page() {
  return (
    <Suspense fallback={null}>
      <GoogleStartClient />
    </Suspense>
  );
}
