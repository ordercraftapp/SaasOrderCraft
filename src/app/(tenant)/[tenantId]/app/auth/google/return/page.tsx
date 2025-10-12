// src/app/(tenant)/[tenantId]/app/auth/google/return/page.tsx
import { Suspense } from "react";
import GoogleReturnClient from "./Client";

export const dynamic = "force-dynamic";
export const revalidate = 0;
// tenancyUpdate: ruta ya está bajo /(tenant)/[tenantId]/...

export default function Page() {
  return (
    <Suspense fallback={null}>
      <GoogleReturnClient />
    </Suspense>
  );
}
