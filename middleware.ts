// middleware.ts — Multi-tenant + CSP base + PayPal + sesión/roles
import { NextResponse, type NextRequest } from "next/server";
import { buildCSP, addPaypalToCsp } from "@/lib/security/csp";

// === Dominio base (site) ===
const BASE_DOMAIN = (process.env.NEXT_PUBLIC_BASE_DOMAIN || "datacraftcoders.cloud").toLowerCase();
const SITE_HOSTS = new Set([BASE_DOMAIN, `www.${BASE_DOMAIN}`]);

// === Sesión/Roles (ajusta nombres de cookies si cambian) ===
const SESSION_COOKIE_KEYS = ["session", "idToken", "auth"]; // cualquiera de estas indica sesión
const ROLE_COOKIE_KEYS = ["appRole", "role", "roles"];      // buscamos el rol principal aquí
type Role = "admin" | "kitchen" | "cashier" | "delivery" | "waiter";

// ---------- Helpers ----------
function withPaypalCsp(res: NextResponse) {
  try {
    const existing = res.headers.get("Content-Security-Policy") || "";
    const base = existing && existing.trim().length > 0
      ? existing
      : buildCSP({ isDev: process.env.NODE_ENV !== "production" });
    const merged = addPaypalToCsp(base);
    res.headers.set("Content-Security-Policy", merged);
  } catch { /* no-op */ }
  return res;
}

function hasSessionCookie(req: NextRequest): boolean {
  const c = req.cookies;
  return SESSION_COOKIE_KEYS.some((k) => Boolean(c.get(k)?.value));
}

function getRole(req: NextRequest): Role | null {
  const c = req.cookies;
  for (const key of ROLE_COOKIE_KEYS) {
    const v = c.get(key)?.value?.toLowerCase();
    if (!v) continue;
    const first = v.split(/[,\s]+/).filter(Boolean)[0];
    if (first === "admin" || first === "kitchen" || first === "cashier" || first === "delivery" || first === "waiter") {
      return first as Role;
    }
  }
  return null;
}

function isPath(pathname: string, prefix: string) {
  return pathname === prefix || pathname.startsWith(prefix + "/");
}

/** Resuelve host → { isSite, tenantId } */
function resolveHost(req: NextRequest) {
  const host = (req.nextUrl.hostname || "").toLowerCase();
  const parts = host.split(".").filter(Boolean);

  const base = BASE_DOMAIN;
  const baseParts = base.split(".").filter(Boolean);

  // ¿host es exactamente el site (base o www.base)?
  if (host === base || host === `www.${base}`) {
    return { isSite: true as const, tenantId: null as null };
  }

  // Caso A: base de 1 label (localhost)
  if (baseParts.length === 1) {
    if (!host.endsWith(`.${base}`)) {
      return { isSite: true as const, tenantId: null as null };
    }
    if (parts.length >= 2 && parts[parts.length - 1] === base) {
      const tenant = parts[parts.length - 2] || null;
      return { isSite: false as const, tenantId: tenant };
    }
    return { isSite: true as const, tenantId: null as null };
  }

  // Caso B: base con 2+ labels (prod)
  const suffix = `.${base}`;
  if (!host.endsWith(suffix)) {
    return { isSite: true as const, tenantId: null as null };
  }

  if (parts.length >= baseParts.length + 1) {
    const tenantIndex = parts.length - (baseParts.length + 1);
    const tenant = parts[tenantIndex] || null;
    return { isSite: false as const, tenantId: tenant };
  }

  return { isSite: true as const, tenantId: null as null };
}

// ---------- PhaseC: helpers para adjuntar tenant a la request downstream ----------
function nextWithTenant(req: NextRequest, tenantId: string) {
  const hdrs = new Headers(req.headers as any);
  hdrs.set("x-tenant", tenantId); // ← importante para API routes/Server Actions
  const res = NextResponse.next({ request: { headers: hdrs } });
  res.cookies.set("tenantId", tenantId, { path: "/", httpOnly: false });
  return res;
}
function rewriteWithTenant(req: NextRequest, url: URL, tenantId: string) {
  const hdrs = new Headers(req.headers as any);
  hdrs.set("x-tenant", tenantId);
  const res = NextResponse.rewrite(url, { request: { headers: hdrs } });
  res.cookies.set("tenantId", tenantId, { path: "/", httpOnly: false });
  return res;
}
function redirectWithTenant(req: NextRequest, url: URL, tenantId: string) {
  const res = NextResponse.redirect(url);
  res.cookies.set("tenantId", tenantId, { path: "/", httpOnly: false });
  return res;
}

// Redirección a /login preservando ?next= y sin romper CSP del login
function redirectToLogin(req: NextRequest, tenantId?: string | null) {
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", req.nextUrl.pathname + (req.nextUrl.search || ""));
  const res = tenantId ? redirectWithTenant(req, url, tenantId) : NextResponse.redirect(url);
  return withPaypalCsp(res);
}

/** Compat: parse `/_t/{tenant}/...` → { tenant, restPath } */
function parseLegacyTenantPath(pathname: string): { tenant: string | null; rest: string | null } {
  // Ej: /_t/mcsusies/login → tenant=mcsusies, rest=/login
  if (!pathname.startsWith("/_t/")) return { tenant: null, rest: null };
  const parts = pathname.split("/").filter(Boolean); // ['_t','tenant',...]
  if (parts.length < 2) return { tenant: null, rest: null };
  const tenant = parts[1] || null;
  const rest = "/" + parts.slice(2).join("/"); // puede ser '' => '/'
  return { tenant, rest: rest || "/" };
}

// ---------- Middleware ----------
export function middleware(req: NextRequest) {
  const url = req.nextUrl.clone();
  const pathname = url.pathname;

  // 0) BYPASS TOTAL para estáticos / callbacks de auth (no tocar CSP)
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/static") ||
    pathname.startsWith("/images") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    /\.[\w]+$/.test(pathname) ||
    pathname.startsWith("/api/auth") || // OAuth/NextAuth callbacks
    pathname.startsWith("/auth/") ||    // flujo de auth propio
    pathname.startsWith("/debug/")
  ) {
    return NextResponse.next();
  }

  // --- Compatibilidad legacy: /_t/{tenant}/... ---
  if (pathname.startsWith("/_t/")) {
    const { tenant, rest } = parseLegacyTenantPath(pathname);
    if (tenant) {
      let targetPath: string;
      if (rest === "/" || rest === "") {
        targetPath = `/${tenant}/app`;
      } else if (rest === "/login") {
        targetPath = `/${tenant}/app/login`;
      } else if ((rest && rest.startsWith("/app/")) || rest === "/app") {
        targetPath = `/${tenant}${rest}`;
      } else if ((rest && rest.startsWith("/admin/")) || rest === "/admin") {
        targetPath = `/${tenant}${rest}`;
      } else {
        // Cualquier otra cosa del legacy va a /app/{rest}
        targetPath = `/${tenant}/app${rest && rest.startsWith("/") ? rest : `/${rest}`}`;
      }
      url.pathname = targetPath;
      return withPaypalCsp(rewriteWithTenant(req, url, tenant));
    }
    // Si no pudo parsear, continúa normal
  }

  // 1) Site vs Tenant por host (compatible con localhost y producción)
  const { isSite, tenantId } = resolveHost(req);

  // Root/www => marketing (site)
  if (isSite || !tenantId) {
    return withPaypalCsp(NextResponse.next());
  }

  // 2) Normaliza rutas del tenant al árbol /:tenantId/app/*
  const supportsWildcard =
    process.env.NEXT_PUBLIC_USE_WILDCARD_SUBDOMAINS?.toLowerCase() !== "false";

  const alreadyPrefixed = pathname.startsWith(`/${tenantId}`);
  let targetPath = pathname;

  if (!alreadyPrefixed) {
    // En wildcard queremos paths limpios: '/', '/app/*', '/admin/*'
    if (pathname === "/") {
      targetPath = `/${tenantId}/app`;
    } else if (pathname === "/login") {
      targetPath = `/${tenantId}/app/login`;
    } else if (pathname === "/app" || pathname.startsWith("/app/")) {
      targetPath = `/${tenantId}${pathname}`;
    } else if (pathname === "/admin" || pathname.startsWith("/admin/")) {
      targetPath = `/${tenantId}${pathname}`;
    } else {
      // ✅ NUEVO: rutas cortas del tenant caen bajo /app/*
      // p.ej. /menu → /{tenantId}/app/menu
      targetPath = `/${tenantId}/app${pathname}`;
    }
  } else {
    // Si ya viene con /{tenantId}, ajusta alias cortos
    if (pathname === `/${tenantId}`) {
      targetPath = `/${tenantId}/app`;
    } else if (pathname === `/${tenantId}/login`) {
      targetPath = `/${tenantId}/app/login`;
    } else if (
      // ✅ NUEVO: si ya viene /{tenantId}/menu → forzar /{tenantId}/app/menu
      !pathname.startsWith(`/${tenantId}/app`) &&
      !pathname.startsWith(`/${tenantId}/admin`)
    ) {
      const rest = pathname.slice(tenantId.length + 1); // quita "/{tenantId}"
      targetPath = `/${tenantId}/app${rest}`;
    }
  }

  if (targetPath !== pathname) {
    url.pathname = targetPath;
    const res = rewriteWithTenant(req, url, tenantId);
    return withPaypalCsp(res);
  }

  // 3) Seguridad por roles (sobre "ruta virtual")
  const virtualPath = tenantId ? pathname.replace(`/${tenantId}`, "") || "/" : pathname;
  const vForRoles = virtualPath.startsWith("/app") ? (virtualPath.slice(4) || "/") : virtualPath;

  // Dejar /login limpio (ya reescrito por tenant). No añadir CSP extra.
  if (vForRoles === "/login") {
    const res = nextWithTenant(req, tenantId);
    return res;
  }

  const wantsAdmin = isPath(vForRoles, "/admin");
  const wantsDelivery = isPath(vForRoles, "/delivery");

  // 3.a) Rutas públicas del tenant → añadir CSP PayPal y adjuntar tenant
  if (!wantsAdmin && !wantsDelivery) {
    const res = withPaypalCsp(nextWithTenant(req, tenantId));
    return res;
  }

  // 3.b) Rutas protegidas: requieren sesión
  if (!hasSessionCookie(req)) {
    return redirectToLogin(req, tenantId);
  }

  const role = getRole(req);

  // 3.c) Validación por rol
  if (wantsDelivery) {
    if (role === "delivery" || role === "admin") {
      return withPaypalCsp(nextWithTenant(req, tenantId));
    }
    const to = new URL("/", req.url);
    return withPaypalCsp(redirectWithTenant(req, to, tenantId));
  }

  if (wantsAdmin) {
    if (role === "admin") return withPaypalCsp(nextWithTenant(req, tenantId));

    if (role === "kitchen") {
      if (isPath(vForRoles, "/admin/kitchen")) return withPaypalCsp(nextWithTenant(req, tenantId));
      const to = new URL("/", req.url);
      return withPaypalCsp(redirectWithTenant(req, to, tenantId));
    }

    if (role === "cashier") {
      if (isPath(vForRoles, "/admin/cashier")) return withPaypalCsp(nextWithTenant(req, tenantId));
      const to = new URL("/", req.url);
      return withPaypalCsp(redirectWithTenant(req, to, tenantId));
    }

    if (role === "waiter") {
      if (isPath(vForRoles, "/admin/edit-orders")) return withPaypalCsp(nextWithTenant(req, tenantId));
      const to = new URL("/", req.url);
      return withPaypalCsp(redirectWithTenant(req, to, tenantId));
    }

    const to = new URL("/", req.url);
    return withPaypalCsp(redirectWithTenant(req, to, tenantId));
  }

  // 4) Fallback (tenant flow): adjuntamos x-tenant + cookie + CSP
  return withPaypalCsp(nextWithTenant(req, tenantId));
}

// Matcher amplio (Next 15)
export const config = { matcher: ["/:path*"] };
