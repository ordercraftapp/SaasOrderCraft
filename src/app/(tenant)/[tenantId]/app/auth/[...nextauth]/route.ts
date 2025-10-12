// src/app/(tenant)/[tenantId]/app/[...nextauth]/route.ts
import NextAuth, { NextAuthOptions } from "next-auth";
import GoogleProvider from "next-auth/providers/google";
import type { NextRequest } from "next/server";

// Tenancy helpers
import { resolveTenantFromRequest, requireTenantId } from "@/lib/tenant/server";

/** ⬇️⬇️⬇️  Exporta esta función para que otros módulos (p. ej. session-bridge) la puedan importar */
export function buildAuthOptions(tenantId: string): NextAuthOptions {
  return {
    session: { strategy: "jwt" },

    providers: [
      GoogleProvider({
        clientId: process.env.GOOGLE_CLIENT_ID!,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
        authorization: { params: { prompt: "select_account" } },
      }),
    ],

    // Cookies con nombre por tenant (evita mezcla entre tenants en path-based routing)
    cookies: {
      sessionToken: {
        name: `next-auth.session-token.${tenantId}`,
        options: { httpOnly: true, sameSite: "lax", path: "/", secure: true },
      },
      callbackUrl: {
        name: `next-auth.callback-url.${tenantId}`,
        options: { sameSite: "lax", path: "/", secure: true },
      },
      csrfToken: {
        name: `next-auth.csrf-token.${tenantId}`,
        options: { httpOnly: false, sameSite: "lax", path: "/", secure: true },
      },
    },

    callbacks: {
      /** Inyecta tenantId al JWT */
      async jwt({ token }) {
        if (!(token as any).tenantId) (token as any).tenantId = tenantId;
        return token;
      },

      /** Propaga a la sesión (lado cliente) */
      async session({ session, token }) {
        (session.user as any).id = token.sub;
        (session as any).tenantId = (token as any).tenantId ?? tenantId;
        return session;
      },

      /** Mantiene los redirects dentro del espacio /{tenantId} */
      async redirect({ url, baseUrl }) {
        if (url.startsWith("/")) {
          if (url.startsWith(`/${tenantId}/`)) return url;
          return `/${tenantId}${url}`;
        }
        try {
          const u = new URL(url);
          const b = new URL(baseUrl);
          if (u.origin === b.origin) {
            const path = u.pathname + u.search + u.hash;
            if (path.startsWith(`/${tenantId}/`)) return path;
            return `/${tenantId}${path}`;
          }
        } catch {
          /* no-op */
        }
        return url;
      },
    },

    pages: {
      signIn: `/${tenantId}/login`,
      newUser: `/${tenantId}/app`,
    },

    secret: process.env.NEXTAUTH_SECRET,
  };
}

/** Handler dinámico por request (resuelve tenantId del path) */
const dynamicHandler = async (req: NextRequest, ctx: { params: { tenantId?: string } }) => {
  const tenantId = requireTenantId(
    resolveTenantFromRequest(req, ctx?.params),
    "auth:nextauth"
  );

  const options = buildAuthOptions(tenantId);

  // (Opcional) eventos, auditoría, etc. — puedes añadirlos aquí si los usas
  const handler = NextAuth(options);
  return handler(req, ctx as any);
};

export { dynamicHandler as GET, dynamicHandler as POST };
