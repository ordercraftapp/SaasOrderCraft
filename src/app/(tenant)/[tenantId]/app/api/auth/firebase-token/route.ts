// src/app/(tenant)/[tenantId]/app/api/auth/firebase-token/route.ts
import { NextResponse, NextRequest } from 'next/server';
import { getServerSession } from 'next-auth/next';
import GoogleProvider from 'next-auth/providers/google';
import type { NextAuthOptions } from 'next-auth';
import { adminAuth } from '@/lib/firebase/admin';
import { resolveTenantFromRequest, requireTenantId } from '@/lib/tenant/server';

export const runtime = 'nodejs';

function buildOptions(req: NextRequest): NextAuthOptions {
  const tenantId = requireTenantId(
    resolveTenantFromRequest(req, { tenantId: undefined as any }),
    'api:auth/firebase-token'
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
    // Las páginas no son estrictamente necesarias para leer sesión,
    // pero si las defines, hazlas tenant-aware:
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

export async function GET(req: NextRequest) {
  try {
    const session = await getServerSession(buildOptions(req));
    if (!session?.user?.email) {
      return NextResponse.json({ error: 'NO_SESSION' }, { status: 401 });
    }

    const providerSub = (session.user as any)?.id as string | undefined;
    if (!providerSub) {
      return NextResponse.json({ error: 'NO_SUB' }, { status: 400 });
    }

    const uid = `google:${providerSub}`;
    const email = session.user.email!;
    const displayName = session.user.name ?? undefined;
    const photoURL = session.user.image ?? undefined;

    // Asegura existencia del usuario
    let exists = true;
    try {
      await adminAuth.getUser(uid);
    } catch {
      exists = false;
    }
    if (!exists) {
      try {
        await adminAuth.createUser({
          uid,
          email,
          emailVerified: true,
          displayName,
          photoURL,
        });
      } catch (e: any) {
        if (e?.code === 'auth/email-already-exists') {
          await adminAuth.createUser({ uid, displayName, photoURL });
        } else {
          throw e;
        }
      }
    }

    // Sincroniza perfil y email si está libre
    try {
      const byEmail = await adminAuth.getUserByEmail(email);
      if (byEmail.uid === uid) {
        await adminAuth.updateUser(uid, {
          email,
          emailVerified: true,
          displayName,
          photoURL,
        });
      } else {
        await adminAuth.updateUser(uid, { displayName, photoURL });
      }
    } catch {
      try {
        await adminAuth.updateUser(uid, {
          email,
          emailVerified: true,
          displayName,
          photoURL,
        });
      } catch (e2: any) {
        if (e2?.code === 'auth/email-already-exists') {
          await adminAuth.updateUser(uid, { displayName, photoURL });
        } else {
          throw e2;
        }
      }
    }

    // Lee claims persistentes (los que gestionas con tu UI / API de admin)
    let persistentClaims: Record<string, any> = {};
    try {
      const rec = await adminAuth.getUser(uid);
      persistentClaims = rec.customClaims || {};
    } catch {
      persistentClaims = {};
    }

    // Claims informativos para el token
    const infoClaims = {
      email,
      email_verified: true,
      name: displayName ?? null,
      picture: photoURL ?? null,
      provider: 'google',
    };

    // Emitimos el custom token con los claims existentes (roles) + info
    const token = await adminAuth.createCustomToken(uid, {
      ...persistentClaims,
      ...infoClaims,
    });

    return NextResponse.json({ token }, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e: any) {
    console.error('[api/auth/firebase-token] error', e);
    return NextResponse.json(
      { error: 'INTERNAL', code: e?.code ?? null, message: e?.message ?? null },
      { status: 500 }
    );
  }
}
