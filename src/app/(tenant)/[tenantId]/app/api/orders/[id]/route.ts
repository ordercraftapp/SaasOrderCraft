// src/app/(tenant)/[tenant]/app/api/orders/[id]/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAdminDB } from "@/lib/firebase/admin";
import { getUserFromRequest } from "@/lib/server/auth";
import { resolveTenantFromRequest, requireTenantId } from "@/lib/tenant/server";

const json = (d: unknown, s = 200) => NextResponse.json(d, { status: s });

const EDITABLE_STATUS = new Set([
  "placed",
  "kitchen_in_progress",
  "kitchen_done",
  "ready_to_close",
]);

function isAdminOrWaiter(user: any) {
  const claims = user?.claims ?? {};
  const role = user?.role ?? claims?.role;
  return !!(claims?.admin || claims?.waiter || role === "admin" || role === "waiter");
}
function isAdmin(user: any) {
  const claims = user?.claims ?? {};
  const role = user?.role ?? claims?.role;
  return !!(claims?.admin || role === "admin");
}

// 📁 carpeta es [tenant] → params.tenant
type Ctx = { params: { tenant: string; id: string } };

/** GET: devuelve la orden por id (requiere auth) */
export async function GET(req: NextRequest, ctx: Ctx) {
  const id = String(ctx.params.id);
  try {
    const user = await getUserFromRequest(req);
    if (!user) return json({ error: "Unauthorized" }, 401);

    const tenantId = requireTenantId(
      resolveTenantFromRequest(req, ctx.params),
      "api:orders/[id]:GET"
    );

    const db = getAdminDB();
    const ref = db.collection(`tenants/${tenantId}/orders`).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return json({ error: "Not found" }, 404);

    const data = snap.data() || {};
    return json({ ok: true, tenantId, order: { id: snap.id, ...data } }, 200);
  } catch (e) {
    console.error("[GET /api/orders/[id]]", e);
    return json({ error: "Server error" }, 500);
  }
}

/**
 * PATCH: editar ítems/amounts/campos de una orden existente
 * - Auth obligatorio, rol admin o waiter
 * - Estado debe ser editable (no closed/cancelled)
 */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const id = String(ctx.params.id);
  try {
    const user = await getUserFromRequest(req);
    if (!user) return json({ error: "Unauthorized" }, 401);
    if (!isAdminOrWaiter(user)) return json({ error: "Forbidden" }, 403);

    const tenantId = requireTenantId(
      resolveTenantFromRequest(req, ctx.params),
      "api:orders/[id]:PATCH"
    );

    const db = getAdminDB();
    const ref = db.collection(`tenants/${tenantId}/orders`).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return json({ error: "Not found" }, 404);

    const current = snap.data()!;
    const curStatus = current.status;
    if (!EDITABLE_STATUS.has(curStatus)) {
      return json({ error: `status_not_editable:${curStatus}` }, 409);
    }

    const body = await req.json();

    // Normaliza items (OPS) y lines (legacy)
    const items = Array.isArray(body.items)
      ? body.items.map((it: any) => ({
          menuItemId: it.menuItemId,
          menuItemName: it.menuItemName,
          quantity: Number(it.quantity ?? 1),
          unitPriceCents: Number(it.unitPriceCents ?? it.priceCents ?? 0),
          basePrice: Number(it.basePrice ?? it.price ?? 0),
          addons: Array.isArray(it.addons) ? it.addons : [],
          optionGroups: Array.isArray(it.optionGroups) ? it.optionGroups : [],
          options: Array.isArray(it.options) ? it.options : [],
          totalCents: Number(it.totalCents ?? 0),
          lineTotal: Number(it.lineTotal ?? 0),
        }))
      : Array.isArray(current.items)
      ? current.items
      : [];

    const legacyLines = Array.isArray(body.lines)
      ? body.lines
      : Array.isArray(current.lines)
      ? current.lines
      : [];

    const patch: any = {
      tenantId, // ✅ siempre persistir tenantId
      items,
      currency: body.currency ?? current.currency ?? "USD",
      amounts: body.amounts ?? current.amounts ?? null,
      orderInfo: {
        ...(current.orderInfo || {}),
        ...(body.orderInfo || {}),
      },
      type: body.type ?? current.type ?? "dine_in",
      tableNumber: body.tableNumber ?? current.tableNumber ?? "",
      notes: body.notes ?? current.notes ?? "",
      // Compat legacy:
      lines: legacyLines,
      updatedAt: FieldValue.serverTimestamp(),
      statusLogs: [
        ...(Array.isArray(current.statusLogs) ? current.statusLogs : []),
        { at: Timestamp.now(), by: (user as any)?.uid ?? "system", type: "edited_lines" },
      ],
    };

    await ref.update(patch);
    const updated = (await ref.get()).data();
    return json({ ok: true, tenantId, id, ...updated }, 200);
  } catch (e: any) {
    console.error("[PATCH /api/orders/[id]]", e);
    return json({ error: e?.message || "Server error" }, 500);
  }
}

/**
 * DELETE: cancelar la orden (soft-cancel)
 * - Admin: siempre
 * - Creador: sólo si status = 'placed'
 */
export async function DELETE(req: NextRequest, ctx: Ctx) {
  const id = String(ctx.params.id);
  try {
    const user = await getUserFromRequest(req);
    if (!user) return json({ error: "Unauthorized" }, 401);

    const tenantId = requireTenantId(
      resolveTenantFromRequest(req, ctx.params),
      "api:orders/[id]:DELETE"
    );

    const db = getAdminDB();
    const ref = db.collection(`tenants/${tenantId}/orders`).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return json({ error: "Not found" }, 404);

    const data = snap.data()!;
    const admin = isAdmin(user);

    if (!admin) {
      if (data.createdBy !== user.uid) return json({ error: "Forbidden" }, 403);
      if (data.status !== "placed") return json({ error: "Only placed orders can be cancelled" }, 409);
    }

    await ref.update({
      tenantId, // ✅ por consistencia
      status: "cancelled",
      updatedAt: FieldValue.serverTimestamp(),
      statusLogs: [
        ...(Array.isArray(data.statusLogs) ? data.statusLogs : []),
        { at: Timestamp.now(), by: (user as any)?.uid ?? "system", type: "cancelled" },
      ],
    });

    return json({ ok: true, tenantId }, 200);
  } catch (e) {
    console.error("[DELETE /api/orders/[id]]", e);
    return json({ error: "Server error" }, 500);
  }
}
