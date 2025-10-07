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
    // Si el response aún no tiene CSP (p.ej. por una ruta temprana), sembramos con base y luego añadimos PayPal
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

/** Resuelve host → { isSite, tenantId }
 *  - Root/www -> site
 *  - Tenant = label inmediatamente anterior al dominio base
 *    acme.datacraftcoders.cloud           -> acme
 *    www.acme.datacraftcoders.cloud       -> acme
 *    x.y.acme.datacraftcoders.cloud       -> acme
 */
function resolveHost(req: NextRequest) {
  const host = (req.nextUrl.hostname || "").toLowerCase();
  const parts = host.split(".");
  const domain = parts.slice(-2).join(".");
  if (SITE_HOSTS.has(host) || domain !== BASE_DOMAIN) {
    return { isSite: true as const, tenantId: null as null };
  }
  const tenant = parts.length >= 3 ? parts[parts.length - 3] : null;
  return { isSite: false as const, tenantId: tenant };
}

// Redirección a /login preservando ?next= y sin romper CSP del login
function redirectToLogin(req: NextRequest) {
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", req.nextUrl.pathname + (req.nextUrl.search || ""));
  const res = NextResponse.redirect(url);
  return withPaypalCsp(res);
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

  // 1) Site vs Tenant por host
  const { isSite, tenantId } = resolveHost(req);

  // Root/www => marketing (site)
  if (isSite || !tenantId) {
    // En site solo añadimos CSP PayPal para páginas públicas
    return withPaypalCsp(NextResponse.next());
  }

  // 2) Normaliza rutas del tenant al árbol /:tenantId/app/*
  //    "/"               -> "/:tenantId/app"
  //    "/login"          -> "/:tenantId/app/login"
  //    "/:tenantId"      -> "/:tenantId/app"
  //    "/:tenantId/login"-> "/:tenantId/app/login"
  //    otro sin prefijo  -> "/:tenantId{pathname}"
  const alreadyPrefixed = pathname.startsWith(`/${tenantId}`);
  let targetPath = pathname;

  if (!alreadyPrefixed) {
    if (pathname === "/") {
      targetPath = `/${tenantId}/app`;
    } else if (pathname === "/login") {
      targetPath = `/${tenantId}/app/login`;
    } else {
      targetPath = `/${tenantId}${pathname}`;
    }
  } else {
    if (pathname === `/${tenantId}`) {
      targetPath = `/${tenantId}/app`;
    } else if (pathname === `/${tenantId}/login`) {
      targetPath = `/${tenantId}/app/login`;
    }
  }

  if (targetPath !== pathname) {
    url.pathname = targetPath;
    const res = NextResponse.rewrite(url);
    // útil si quieres leer el tenant en cliente
    res.cookies.set("tenantId", tenantId, { path: "/", httpOnly: false });
    return withPaypalCsp(res);
  }

  // 3) Seguridad por roles (sobre "ruta virtual")
  //    Quita "/:tenantId" y opcionalmente "/app" para evaluar
  const virtualPath = tenantId ? pathname.replace(`/${tenantId}`, "") || "/" : pathname;
  const vForRoles = virtualPath.startsWith("/app") ? (virtualPath.slice(4) || "/") : virtualPath;

  // Dejar /login limpio (ya reescrito por tenant). No añadir CSP extra.
  if (vForRoles === "/login") {
    return NextResponse.next();
  }

  const wantsAdmin = isPath(vForRoles, "/admin");
  const wantsDelivery = isPath(vForRoles, "/delivery");

  // 3.a) Rutas públicas del tenant → añadir CSP PayPal únicamente
  if (!wantsAdmin && !wantsDelivery) {
    return withPaypalCsp(NextResponse.next());
  }

  // 3.b) Rutas protegidas: requieren sesión
  if (!hasSessionCookie(req)) {
    return redirectToLogin(req);
  }

  const role = getRole(req);

  // 3.c) Validación por rol
  if (wantsDelivery) {
    if (role === "delivery" || role === "admin") {
      return withPaypalCsp(NextResponse.next());
    }
    const to = new URL("/", req.url);
    const res = NextResponse.redirect(to);
    return withPaypalCsp(res);
  }

  if (wantsAdmin) {
    if (role === "admin") return withPaypalCsp(NextResponse.next());

    if (role === "kitchen") {
      if (isPath(vForRoles, "/admin/kitchen")) return withPaypalCsp(NextResponse.next());
      const to = new URL("/", req.url);
      return withPaypalCsp(NextResponse.redirect(to));
    }

    if (role === "cashier") {
      if (isPath(vForRoles, "/admin/cashier")) return withPaypalCsp(NextResponse.next());
      const to = new URL("/", req.url);
      return withPaypalCsp(NextResponse.redirect(to));
    }

    if (role === "waiter") {
      if (isPath(vForRoles, "/admin/edit-orders")) return withPaypalCsp(NextResponse.next());
      const to = new URL("/", req.url);
      return withPaypalCsp(NextResponse.redirect(to));
    }

    const to = new URL("/", req.url);
    return withPaypalCsp(NextResponse.redirect(to));
  }

  // 4) Fallback
  return withPaypalCsp(NextResponse.next());
}

// Matcher amplio (Next 15)
export const config = { matcher: ["/:path*"] };
