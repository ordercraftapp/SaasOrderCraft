import { NextResponse, type NextRequest } from "next/server";
import { buildCSP, addPaypalToCsp } from "@/lib/security/csp";

const BASE_DOMAIN = (process.env.NEXT_PUBLIC_BASE_DOMAIN || "datacraftcoders.cloud").toLowerCase();
const SITE_HOSTS = new Set([BASE_DOMAIN, `www.${BASE_DOMAIN}`]);

const SESSION_COOKIE_KEYS = ["session", "idToken", "auth"];
const ROLE_COOKIE_KEYS = ["appRole", "role", "roles"];
type Role = "admin" | "kitchen" | "cashier" | "delivery" | "waiter";

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

  if (host === base || host === `www.${base}`) {
    return { isSite: true as const, tenantId: null as null };
  }

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
  hdrs.set("x-tenant-id", tenantId); // ⬅️ unificado
  const res = NextResponse.next({ request: { headers: hdrs } });
  res.cookies.set("tenantId", tenantId, { path: "/", httpOnly: false });
  return res;
}
function rewriteWithTenant(req: NextRequest, url: URL, tenantId: string) {
  const hdrs = new Headers(req.headers as any);
  hdrs.set("x-tenant-id", tenantId); // ⬅️ unificado
  const res = NextResponse.rewrite(url, { request: { headers: hdrs } });
  res.cookies.set("tenantId", tenantId, { path: "/", httpOnly: false });
  return res;
}
function redirectWithTenant(req: NextRequest, url: URL, tenantId: string) {
  const res = NextResponse.redirect(url);
  res.cookies.set("tenantId", tenantId, { path: "/", httpOnly: false });
  return res;
}

function redirectToLogin(req: NextRequest, tenantId?: string | null) {
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", req.nextUrl.pathname + (req.nextUrl.search || ""));
  const res = tenantId ? redirectWithTenant(req, url, tenantId) : NextResponse.redirect(url);
  return withPaypalCsp(res);
}

function parseLegacyTenantPath(pathname: string): { tenant: string | null; rest: string | null } {
  if (!pathname.startsWith("/_t/")) return { tenant: null, rest: null };
  const parts = pathname.split("/").filter(Boolean);
  if (parts.length < 2) return { tenant: null, rest: null };
  const tenant = parts[1] || null;
  const rest = "/" + parts.slice(2).join("/");
  return { tenant, rest: rest || "/" };
}

export function middleware(req: NextRequest) {
  const url = req.nextUrl.clone();
  const pathname = url.pathname;

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/static") ||
    pathname.startsWith("/images") ||
    pathname === "/favicon.ico" ||
    pathname === "/robots.txt" ||
    pathname === "/sitemap.xml" ||
    /\.[\w]+$/.test(pathname) ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/debug/")
  ) {
    return NextResponse.next();
  }

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
        targetPath = `/${tenant}/app${rest && rest.startsWith("/") ? rest : `/${rest}`}`;
      }
      url.pathname = targetPath;
      return withPaypalCsp(rewriteWithTenant(req, url, tenant));
    }
  }

  const { isSite, tenantId } = resolveHost(req);
  if (isSite || !tenantId) {
    return withPaypalCsp(NextResponse.next());
  }

  const alreadyPrefixed = pathname.startsWith(`/${tenantId}`);
  let targetPath = pathname;

  if (!alreadyPrefixed) {
    if (pathname === "/") {
      targetPath = `/${tenantId}/app`;
    } else if (pathname === "/login") {
      targetPath = `/${tenantId}/app/login`;
    } else if (pathname === "/app" || pathname.startsWith("/app/")) {
      targetPath = `/${tenantId}${pathname}`;
    } else if (pathname === "/admin" || pathname.startsWith("/admin/")) {
      targetPath = `/${tenantId}${pathname}`;
    } else {
      targetPath = `/${tenantId}/app${pathname}`;
    }
  } else {
    if (pathname === `/${tenantId}`) {
      targetPath = `/${tenantId}/app`;
    } else if (pathname === `/${tenantId}/login`) {
      targetPath = `/${tenantId}/app/login`;
    } else if (
      !pathname.startsWith(`/${tenantId}/app`) &&
      !pathname.startsWith(`/${tenantId}/admin`)
    ) {
      const rest = pathname.slice(tenantId.length + 1);
      targetPath = `/${tenantId}/app${rest}`;
    }
  }

  if (targetPath !== pathname) {
    url.pathname = targetPath;
    const res = rewriteWithTenant(req, url, tenantId);
    return withPaypalCsp(res);
  }

  const virtualPath = tenantId ? pathname.replace(`/${tenantId}`, "") || "/" : pathname;
  const vForRoles = virtualPath.startsWith("/app") ? (virtualPath.slice(4) || "/") : virtualPath;

  if (vForRoles === "/login") {
    const res = nextWithTenant(req, tenantId);
    return withPaypalCsp(res); // ⬅️ añadido para mantener CSP consistente en /login
  }

  const wantsAdmin = isPath(vForRoles, "/admin");
  const wantsDelivery = isPath(vForRoles, "/delivery");

  if (!wantsAdmin && !wantsDelivery) {
    const res = withPaypalCsp(nextWithTenant(req, tenantId));
    return res;
  }

  if (!hasSessionCookie(req)) {
    return redirectToLogin(req, tenantId);
  }

  const role = getRole(req);

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
      if (isPath(vForRoles, "/admin/waiter")) return withPaypalCsp(nextWithTenant(req, tenantId));
      const to = new URL("/", req.url);
      return withPaypalCsp(redirectWithTenant(req, to, tenantId));
    }

    if (role === "delivery") {
      if (isPath(vForRoles, "/admin/delivery")) return withPaypalCsp(nextWithTenant(req, tenantId));
      const to = new URL("/", req.url);
      return withPaypalCsp(redirectWithTenant(req, to, tenantId));
    }

    const to = new URL("/", req.url);
    return withPaypalCsp(redirectWithTenant(req, to, tenantId));
  }

  return withPaypalCsp(nextWithTenant(req, tenantId));
}

export const config = { matcher: ["/:path*"] };
