// src/app/(tenant)/[tenant]/app/api/orders/[id]/status/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDB, adminAuth } from "@/lib/firebase/admin";
import { resolveTenantFromRequest, requireTenantId } from "@/lib/tenant/server";

/** ---------- Helpers de Auth/Roles ---------- */
async function getUserFromAuthHeader(req: NextRequest) {
  const hdr = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!hdr || !hdr.toLowerCase().startsWith("bearer ")) return null;
  const token = hdr.slice(7).trim();
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    return decoded as any; // { uid, email, tenants?, admin?, role?, roles?[] ... }
  } catch {
    return null;
  }
}

/** Normaliza nodo por-tenant: acepta { admin:true, kitchen:true } o { roles:{ admin:true,... } } */
function normalizeTenantNode(node: any): Record<string, boolean> {
  if (!node) return {};
  if (node.roles && typeof node.roles === "object") return { ...(node.roles as any) };
  return { ...(node as any) };
}

function hasRoleGlobal(claims: any, role: string) {
  // admite boolean claim global (claims.admin === true) o arreglo global claims.roles=["admin",...]
  return !!(claims && (claims[role] === true || (Array.isArray(claims.roles) && claims.roles.includes(role)) || claims.role === role));
}

function hasRoleTenant(claims: any, tenantId: string, role: string) {
  const node = claims?.tenants?.[tenantId];
  const flags = normalizeTenantNode(node);
  return !!flags?.[role];
}

/** Puede operar en cocina: admin/kitchen/cashier/delivery por-tenant, o global legacy admin/waiter */
function canOperateTenant(claims: any, tenantId: string) {
  // por-tenant
  if (hasRoleTenant(claims, tenantId, "admin")) return true;
  if (hasRoleTenant(claims, tenantId, "kitchen")) return true;
  if (hasRoleTenant(claims, tenantId, "cashier")) return true;
  if (hasRoleTenant(claims, tenantId, "delivery")) return true;
  // compat global (legado)
  if (hasRoleGlobal(claims, "admin")) return true;
  if (hasRoleGlobal(claims, "waiter")) return true;
  return false;
}

/** ---------- Flujos permitidos ---------- */
const FLOW_DINE_IN = ["placed", "kitchen_in_progress", "kitchen_done", "ready_to_close", "closed"] as const;
const FLOW_DELIVERY = ["placed", "kitchen_in_progress", "kitchen_done", "assigned_to_courier", "on_the_way", "delivered", "closed"] as const;
type StatusSnake = (typeof FLOW_DINE_IN[number]) | (typeof FLOW_DELIVERY[number]) | "cart" | "cancelled";

/** ✅ Normaliza el tipo operativo (pickup → dine_in) */
function normalizeOperationalType(order: any): "dine_in" | "delivery" {
  const raw = String(order?.orderInfo?.type || order?.type || "").toLowerCase();
  if (raw === "delivery") return "delivery";
  return "dine_in";
}
function flowFor(t: "dine_in" | "delivery") {
  return t === "delivery" ? FLOW_DELIVERY : FLOW_DINE_IN;
}

function toSnakeStatus(s: string): StatusSnake {
  const alias: Record<string, StatusSnake> = {
    ready: "ready_to_close",
    served: "ready_to_close",
    completed: "closed",
    ready_for_delivery: "assigned_to_courier",
    out_for_delivery: "on_the_way",
  };
  const snake = s.includes("_") ? s : s.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
  return (alias[snake] ?? snake) as StatusSnake;
}

// 📁 carpeta es [tenant] → params.tenant
type Ctx = { params: { tenant: string; id: string } };

/** ---------- PATCH: cambiar estado ---------- */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    // 🔐 tenant
    const tenantId = requireTenantId(
      resolveTenantFromRequest(req, ctx.params),
      "api:orders/[id]/status:PATCH"
    );

    // 🔐 auth + roles
    const user = await getUserFromAuthHeader(req);
    if (!user) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (!canOperateTenant(user, tenantId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const id = ctx.params.id;
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    let body: any;
    try { body = await req.json(); } catch { body = {}; }
    const nextStatus = toSnakeStatus(String(body?.nextStatus || "").trim());
    if (!nextStatus) return NextResponse.json({ error: "Missing nextStatus" }, { status: 400 });

    const db = getAdminDB();
    const ref = db.collection(`tenants/${tenantId}/orders`).doc(id);

    // Usamos transacción para validar y escribir atomícamente
    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new Error("Order not found");
      const order: any = { id: snap.id, ...snap.data() };

      const currentStatus = String(order.status || "placed") as StatusSnake;

      // ✅ usar flujo operativo (pickup → dine_in)
      const typeForFlow = normalizeOperationalType(order);
      const allowed = flowFor(typeForFlow);

      // Validaciones de transición (permite 1 paso adelante; y 1 atrás)
      const curIdx = allowed.indexOf(currentStatus as any);
      const nxtIdx = allowed.indexOf(nextStatus as any);

      const isForward = curIdx >= 0 && nxtIdx === curIdx + 1;
      const isBackward = curIdx >= 0 && nxtIdx === curIdx - 1;

      if (!isForward && !isBackward) {
        const msg = `Invalid transition: ${currentStatus} → ${nextStatus} (type=${order?.orderInfo?.type || order?.type || "unknown"})`;
        // 409 más expresivo que 400 para transición inválida
        const err: any = new Error(msg);
        err.status = 409;
        throw err;
      }

      // Status history (append)
      const hist = Array.isArray(order.statusHistory) ? order.statusHistory.slice() : [];
      hist.push({
        at: new Date().toISOString(),
        by: (user as any)?.uid || null,
        from: currentStatus,
        to: nextStatus,
      });

      tx.update(ref, {
        tenantId,                    // ✅ siempre persistir tenantId
        status: nextStatus,
        statusHistory: hist,
        updatedAt: FieldValue.serverTimestamp(),
      });

      return { ok: true, tenantId, id, from: currentStatus, to: nextStatus };
    });

    return NextResponse.json(result, { status: 200 });
  } catch (e: any) {
    const status = Number(e?.status) || 400;
    return NextResponse.json({ error: e?.message || "Error" }, { status });
  }
}

/** (Opcional) HEAD/OPTIONS si ya los exponías */
export async function OPTIONS() {
  return NextResponse.json({ ok: true });
}
