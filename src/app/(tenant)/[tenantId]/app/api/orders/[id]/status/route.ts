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
    return decoded as any; // { uid, email, roles?, admin?, kitchen?, cashier?, delivery? }
  } catch {
    return null;
  }
}
function hasRole(claims: any, role: string) {
  // admite boolean claim (claims.admin=true) o arreglo claims.roles=["admin",...]
  return !!(claims && (claims[role] === true || (Array.isArray(claims.roles) && claims.roles.includes(role))));
}
function canOperate(claims: any) {
  return hasRole(claims, "admin") || hasRole(claims, "kitchen") || hasRole(claims, "cashier") || hasRole(claims, "delivery");
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
    if (!user || !canOperate(user)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const id = ctx.params.id;
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    let body: any;
    try { body = await req.json(); } catch { body = {}; }
    const nextStatus = String(body?.nextStatus || "").trim() as StatusSnake;
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

      // Validaciones de transición (permite 1 paso adelante; opcional: 1 paso atrás)
      const curIdx = allowed.indexOf(currentStatus as any);
      const nxtIdx = allowed.indexOf(nextStatus as any);

      const isForward = curIdx >= 0 && nxtIdx === curIdx + 1;
      const isBackward = curIdx >= 0 && nxtIdx === curIdx - 1;

      if (!isForward && !isBackward) {
        throw new Error(
          `Invalid transition: ${currentStatus} → ${nextStatus} (type=${order?.orderInfo?.type || order?.type || "unknown"})`
        );
      }

      // Status history (append)
      const hist = Array.isArray(order.statusHistory) ? order.statusHistory.slice() : [];
      hist.push({
        at: new Date().toISOString(),
        by: user.uid || null,
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
    return NextResponse.json({ error: e?.message || "Error" }, { status: 400 });
  }
}

/** (Opcional) HEAD/OPTIONS si ya los exponías */
export async function OPTIONS() {
  return NextResponse.json({ ok: true });
}
