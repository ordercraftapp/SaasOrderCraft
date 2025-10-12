// src/app/(tenant)/[tenantId]/app/api/auth/session-bridge/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import GoogleProvider from 'next-auth/providers/google';
import type { NextAuthOptions } from 'next-auth';
import { adminAuth } from '@/lib/firebase/admin';
import { resolveTenantFromRequest, requireTenantId } from '@/lib/tenant/server';

export const runtime = 'nodejs';

type Role = 'admin' | 'kitchen' | 'cashier' | 'delivery' | 'waiter' | 'customer';

function claimsToRole(claims: Record<string, any>): Role {
  if (claims?.admin) return 'admin';
  if (claims?.kitchen) return 'kitchen';
  if (claims?.cashier) return 'cashier';
  if (claims?.delivery) return 'delivery';
  if (claims?.waiter || (typeof claims?.role === 'string' && claims.role.toLowerCase() === 'waiter')) {
    return 'waiter';
  }
  return 'customer';
}

function roleToDefaultPath(role: Role): string {
  switch (role) {
    case 'admin': return '/admin';
    case 'kitchen': return '/admin/kitchen';
    case 'cashier': return '/admin/cashier';
    case 'delivery': return '/delivery';
    case 'waiter': return '/admin/edit-orders';
    default: return '/app';
  }
}

// Solo aceptamos rutas relativas internas; cualquier otra cosa → '/app'
function normalizeNextParam(raw: string | null): string {
  if (!raw) return '/app';
  try {
    // Si es URL absoluta, la descartamos
    const u = new URL(raw);
    if (u.protocol && u.host) return '/app';
  } catch {
    // no es URL absoluta → está bien
  }
  return raw.startsWith('/') ? raw : '/app';
}

function tenantizePath(p: string, tenantId: string): string {
  const path = normalizeNextParam(p);
  const prefix = `/${tenantId}`;
  return path.startsWith(prefix) ? path : `${prefix}${path}`;
}

// Construye NextAuth options por request (tenant-aware)
function buildOptions(req: NextRequest): NextAuthOptions {
  const tenantId = requireTenantId(
    resolveTenantFromRequest(req, { tenantId: undefined as any }),
    'api:auth/session-bridge'
  );

  return {
    secret: process.env.NEXTAUTH_SECRET,
    providers: [
      GoogleProvider({
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        authorization: { params: { prompt: 'select_account' } },
      }),
    ],
    pages: {
      signIn: `/${tenantId}/app/login`,
      error: `/${tenantId}/app/api/auth/error`,
    },
    callbacks: {
      async jwt({ token }) {
        (token as any).tenantId = tenantId;
        return token;
      },
      async session({ session, token }) {
        (session.user as any).id = token.sub;
        (session as any).tenantId = (token as any).tenantId || tenantId;
        return session;
      },
    },
  };
}

export async function GET(req: NextRequest, { params }: { params: { tenantId: string } }) {
  const isProd = process.env.NODE_ENV === 'production';
  const tenantId = requireTenantId(
    resolveTenantFromRequest(req, params),
    'api:auth/session-bridge:GET'
  );

  const url = new URL(req.url);
  const rawNext = url.searchParams.get('next');
  const nextParam = tenantizePath(normalizeNextParam(rawNext), tenantId);

  const session = await getServerSession(buildOptions(req));
  if (!session?.user?.email) {
    const back = new URL(`/${tenantId}/app/login`, req.url);
    back.searchParams.set('next', nextParam);
    return NextResponse.redirect(back, { headers: { 'Cache-Control': 'no-store' } });
  }

  const providerSub = (session.user as any)?.id as string | undefined;
  if (!providerSub) {
    const back = new URL(`/${tenantId}/app/login`, req.url);
    back.searchParams.set('next', nextParam);
    return NextResponse.redirect(back, { headers: { 'Cache-Control': 'no-store' } });
  }

  const uid = `google:${providerSub}`;

  // Lee claims actuales del usuario (setCustomUserClaims)
  let role: Role = 'customer';
  try {
    const rec = await adminAuth.getUser(uid);
    role = claimsToRole(rec.customClaims || {});
  } catch {
    role = 'customer';
  }

  const targetPath = role === 'customer'
    ? nextParam
    : tenantizePath(roleToDefaultPath(role), tenantId);

  const redirectTo = new URL(
    `/${tenantId}/app/auth/firebase/complete?next=${encodeURIComponent(targetPath)}`,
    req.url
  );

  const res = NextResponse.redirect(redirectTo, { headers: { 'Cache-Control': 'no-store' } });

  // Cookies para el middleware
  res.cookies.set('session', '1', {
    path: '/',
    httpOnly: false,
    sameSite: 'lax',
    secure: isProd,
  });
  res.cookies.set('appRole', role, {
    path: '/',
    httpOnly: false,
    sameSite: 'lax',
    secure: isProd,
  });

  return res;
}
