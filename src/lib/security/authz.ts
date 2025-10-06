// src/lib/security/authz.ts
import { NextRequest } from "next/server";
import { getAdminAuth } from "@/lib/firebase/admin";

export type ServerUser = {
  uid: string;
  email?: string;
  roles: string[];   // normalizamos: ["admin", "kitchen", ...]
};

export async function getUserFromRequest(req: NextRequest): Promise<ServerUser | null> {
  try {
    // 1) Buscar token en header o cookie
    const authz = req.headers.get("authorization") || "";
    let idToken = "";
    if (authz.toLowerCase().startsWith("bearer ")) {
      idToken = authz.slice(7).trim();
    } else {
      // fallback a cookie (si decides setearla en el cliente)
      const cookie = req.headers.get("cookie") || "";
      const m = cookie.match(/(?:^|;)\s*__session=([^;]+)/);
      if (m) idToken = decodeURIComponent(m[1]);
    }
    if (!idToken) return null;

    // 2) Verificar token
    const auth = getAdminAuth();
    const decoded = await auth.verifyIdToken(idToken, /*checkRevoked=*/false);

    // 3) Normalizar roles desde custom claims
    // - Puedes usar "role" (string) o "roles" (array/obj) según lo que ya asignas
    const roles: string[] = [];
    const claimRole = (decoded as any).role;
    const claimRoles = (decoded as any).roles;

    if (typeof claimRole === "string") roles.push(claimRole);
    if (Array.isArray(claimRoles)) roles.push(...claimRoles);
    if (claimRoles && typeof claimRoles === "object") {
      // si guardaste como {admin:true, kitchen:true}
      for (const k of Object.keys(claimRoles)) {
        if (claimRoles[k]) roles.push(k);
      }
    }

    // uniq
    const uniq = Array.from(new Set(roles));

    return {
      uid: decoded.uid,
      email: decoded.email,
      roles: uniq,
    };
  } catch {
    return null;
  }
}

export async function requireAdmin(req: NextRequest): Promise<ServerUser> {
  const user = await getUserFromRequest(req);
  if (!user) throw new Error("Unauthorized");
  if (!user.roles.includes("admin")) throw new Error("Forbidden");
  return user;
}
