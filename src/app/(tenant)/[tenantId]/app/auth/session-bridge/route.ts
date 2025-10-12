// src/app/(tenant)/[tenantId]/app/auth/session-bridge/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth/next";
import { buildAuthOptions } from "../[...nextauth]/route"; // tenancyUpdate: usar opciones por-tenant
import { resolveTenantFromRequest, requireTenantId } from "@/lib/tenant/server";

// Normaliza un destino para mantenerlo dentro de /{tenantId}
function toTenantPath(raw: string | null | undefined, tenantId: string) {
  const fallback = `/${tenantId}/app`;
  if (!raw) return fallback;
  try {
    const u = new URL(raw);
    raw = u.pathname + u.search + u.hash;
  } catch { /* raw es relativo */ }
  if (raw.startsWith(`/${tenantId}/`)) return raw;
  if (raw.startsWith("/")) return `/${tenantId}${raw}`;
  return `/${tenantId}/${raw}`;
}

export async function GET(req: NextRequest, ctx: { params: { tenantId?: string } }) {
  const tenantId = requireTenantId(
    resolveTenantFromRequest(req, ctx?.params),
    "auth:session-bridge"
  );

  const url = new URL(req.url);
  const requestedNext = url.searchParams.get("next");
  const next = toTenantPath(requestedNext, tenantId); // tenancyUpdate

  // ✅ Lee sesión de NextAuth usando opciones del tenant
  const session = await getServerSession(buildAuthOptions(tenantId));

  if (!session?.user?.email) {
    // ❌ No hay sesión NextAuth → redirige al login del tenant con next normalizado
    const back = new URL(`/${tenantId}/login`, req.url);
    back.searchParams.set("next", next);
    return NextResponse.redirect(back);
  }

  // ✅ Cookie de sesión ligera para tu middleware actual (scopiada al tenant)
  const res = NextResponse.redirect(new URL(next, req.url));
  res.cookies.set("session", "1", {
    path: `/${tenantId}`, // tenancyUpdate: limita al espacio del tenant
    httpOnly: false,
    sameSite: "lax",
    secure: true,
  });
  // Si necesitas rol:
  // res.cookies.set("appRole", "customer", { path: `/${tenantId}`, sameSite: "lax", secure: true });

  return res;
}
