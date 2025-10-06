import { NextResponse, type NextRequest } from "next/server";

const BASE_DOMAIN = (process.env.NEXT_PUBLIC_BASE_DOMAIN || "datacraftcoders.cloud").toLowerCase();
const SITE_HOSTS = new Set([BASE_DOMAIN, `www.${BASE_DOMAIN}`]);

function resolveHost(req: NextRequest) {
  const host = (req.nextUrl.hostname || "").toLowerCase(); // ej. acme.datacraftcoders.cloud
  const parts = host.split(".");
  const domain = parts.slice(-2).join(".");                 // datacraftcoders.cloud
  if (SITE_HOSTS.has(host) || domain !== BASE_DOMAIN) {
    return { isSite: true as const, tenantId: null as null };
  }
  // label inmediato anterior al dominio base ⇒ tenant
  const tenant = parts.length >= 3 ? parts[parts.length - 3] : null;
  return { isSite: false as const, tenantId: tenant };
}

export function middleware(req: NextRequest) {
  const url = req.nextUrl.clone();
  const pathname = url.pathname;
  const { isSite, tenantId } = resolveHost(req);

  // Bypass archivos y auth-callbacks
  if (
    pathname.startsWith("/_next") || pathname.startsWith("/static") || pathname.startsWith("/images") ||
    pathname === "/favicon.ico" || pathname === "/robots.txt" || pathname === "/sitemap.xml" ||
    /\.[\w]+$/.test(pathname) || pathname.startsWith("/api/auth") || pathname.startsWith("/auth/")
  ) {
    return NextResponse.next();
  }

  // Root/www => marketing (site)
  if (isSite || !tenantId) return NextResponse.next();

  // Tenant: normaliza paths al árbol /:tenantId/app/*
  const alreadyPrefixed = pathname.startsWith(`/${tenantId}`);
  let targetPath = pathname;

  if (!alreadyPrefixed) {
    if (pathname === "/")         targetPath = `/${tenantId}/app`;
    else if (pathname === "/login") targetPath = `/${tenantId}/app/login`;
    else                          targetPath = `/${tenantId}${pathname}`;
  } else {
    if (pathname === `/${tenantId}`)       targetPath = `/${tenantId}/app`;
    else if (pathname === `/${tenantId}/login`) targetPath = `/${tenantId}/app/login`;
  }

  if (targetPath !== pathname) {
    url.pathname = targetPath;
    return NextResponse.rewrite(url);
  }
  return NextResponse.next();
}

export const config = { matcher: ["/:path*"] };
