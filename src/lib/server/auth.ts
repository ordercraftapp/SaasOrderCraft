// lib/server/auth.ts
import { adminAuth } from "@/lib/firebase/admin";

function extractBearer(raw?: string | null): string | null {
  if (!raw) return null;
  const v = raw.trim();
  if (!v) return null;
  // Soporta "Bearer token" con espacios extra o mayúsculas variadas
  const prefix = /^bearer\s+/i;
  return prefix.test(v) ? v.replace(prefix, "").trim() : v;
}

export async function getUserFromRequest(req: Request) {
  // Intenta múltiples cabeceras por si algún proxy elimina/renombra Authorization
  // (p.ej. Cloudflare / nginx). Mantenemos compatibilidad con tu cliente actual.
  const h = req.headers;
  const authHeader =
    h.get("authorization") ||
    h.get("Authorization") ||
    h.get("x-authorization") ||
    h.get("x-id-token") ||
    "";

  // Si viene como "Bearer <token>", extráelo; si no, úsalo tal cual.
  const token = extractBearer(authHeader) ?? (authHeader?.trim() || null);
  if (!token) return null;

  try {
    // No activamos checkRevoked para evitar 401 innecesarios por clock skew.
    const decoded = await adminAuth.verifyIdToken(token);

    // Lee posibles custom claims
    const email = (decoded as any).email ?? null;
    const role =
      ((decoded as any).role as "admin" | "client" | undefined) ??
      (Array.isArray((decoded as any).roles) && (decoded as any).roles.includes("admin")
        ? ("admin" as const)
        : undefined);

    return { uid: decoded.uid, email, role };
  } catch {
    // Silencioso como antes: simplemente devuelve null para que la ruta responda 401
    return null;
  }
}
