// src/app/(tenant)/[tenantId]/app/api/auth/[...nextauth]/route.ts
import NextAuth, { type NextAuthOptions } from 'next-auth';
import GoogleProvider from 'next-auth/providers/google';
import { NextRequest } from 'next/server';
import { resolveTenantFromRequest, requireTenantId } from '@/lib/tenant/server';

export const runtime = 'nodejs';

// 🔧 Construye opciones por request (tenant-aware)
function buildOptions(req: NextRequest): NextAuthOptions {
  const tenantId = requireTenantId(
    resolveTenantFromRequest(req, { tenantId: undefined as any }),
    'api:auth/[...nextauth]'
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
    // Páginas dentro del tenant
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

// ✅ En App Router v4, exporta handlers que llaman NextAuth(req, ctx, options)
const GET = (req: NextRequest, ctx: any) => NextAuth(req, ctx, buildOptions(req));
const POST = (req: NextRequest, ctx: any) => NextAuth(req, ctx, buildOptions(req));

export { GET, POST };
