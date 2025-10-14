import "server-only";
import { adminDb } from "@/lib/firebase/admin";

export type OpRole = "admin" | "kitchen" | "waiter" | "delivery" | "cashier";
const OP_ROLES: OpRole[] = ["admin", "kitchen", "waiter", "delivery", "cashier"];

export async function getTenantRoleForUser(tenantId: string, uid: string): Promise<OpRole | "customer"> {
  const mRef = adminDb.doc(`tenants/${tenantId}/members/${uid}`);
  const mSnap = await mRef.get();
  if (!mSnap.exists) return "customer";
  const role = String((mSnap.data() as any)?.role || "").toLowerCase();
  return (OP_ROLES as string[]).includes(role) ? (role as OpRole) : "customer";
}

export async function requireTenantAdmin(tenantId: string, uid: string) {
  const role = await getTenantRoleForUser(tenantId, uid);
  if (role !== "admin") {
    const err: any = new Error("Forbidden: admin role required");
    err.status = 403;
    throw err;
  }
}

export function isValidOpRole(role: unknown): role is OpRole {
  return typeof role === "string" && (OP_ROLES as string[]).includes(role);
}
