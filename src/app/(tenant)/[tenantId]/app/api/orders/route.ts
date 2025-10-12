// src/app/(tenant)/[tenant]/app/api/orders/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { getAdminDB } from "@/lib/firebase/admin";
import { getUserFromRequest } from "@/lib/server/auth";
import { resolveTenantFromRequest, requireTenantId } from "@/lib/tenant/server";

const json = (d: unknown, s = 200) => NextResponse.json(d, { status: s });

type OrderType = "dine_in" | "takeaway" | "delivery";

type LineInput = {
  itemId: string;
  name: string;
  qty: number;
  unitPriceCents: number;
  totalCents: number;
};

type OpsItem = {
  menuItemId: string;
  menuItemName?: string;
  quantity: number;
  options?: Array<{
    groupName: string;
    selected: Array<{ name: string; priceDelta: number }>;
  }>;
};

type CreateOrderBody = {
  type: OrderType;
  // formato OPS
  items?: Array<{
    menuItemId: string;
    menuItemName?: string;
    quantity: number;
    options?: Array<{ groupName: string; selected: Array<{ name: string; priceDelta: number }> }>;
  }>;
  amounts?: { subtotal: number; tax?: number; serviceFee?: number; discount?: number; tip?: number; total: number };
  tableNumber?: string;
  notes?: string;
  currency?: string;
  meta?: Record<string, any>;
  deliveryAddress?: any;
  contactPhone?: string;
  // compat
  lines?: any[];
  cart?: any[];
  orderLines?: any[];
};

// 📁 carpeta es [tenant] → params.tenant
type Ctx = { params: { tenant: string } };

function normalizeOpsItems(items: OpsItem[]) {
  return items.map((it) => {
    const options =
      Array.isArray(it.options)
        ? it.options.map((g) => ({
            groupName: String(g.groupName ?? ""),
            selected: Array.isArray(g.selected)
              ? g.selected.map((s) => ({ name: String(s.name ?? ""), priceDelta: Number(s.priceDelta ?? 0) }))
              : [],
          }))
        : [];

    return {
      menuItemId: String(it.menuItemId),
      menuItemName: String(it.menuItemName ?? ""),
      quantity: Number.isFinite(it.quantity) ? it.quantity : 1,
      options,
    };
  });
}

function centsFromAmount(qty: number, priceDelta: number | undefined) {
  const n = Number(priceDelta ?? 0);
  return Math.round(qty * n * 100);
}

/* -------------------- GET: listar con compat (scopiado al tenant) -------------------- */
export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const tenantId = requireTenantId(
      resolveTenantFromRequest(req, ctx.params),
      "api:orders:GET"
    );

    const { searchParams } = new URL(req.url);
    const limit = Math.min(Number(searchParams.get("limit") || 20), 100);
    const status = searchParams.get("status");

    const db = getAdminDB();
    let query: FirebaseFirestore.Query = db
      .collection(`tenants/${tenantId}/orders`)
      .orderBy("createdAt", "desc");

    if (status) query = query.where("status", "==", status);

    const snap = await query.limit(limit).get();
    const orders = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return json({ ok: true, tenantId, orders });
  } catch (e: any) {
    console.error("[GET /api/orders]", e);
    return json({ error: e?.message ?? "Server error" }, 500);
  }
}

/* -------------------- POST: crear orden (scopiado al tenant) -------------------- */
export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const tenantId = requireTenantId(
      resolveTenantFromRequest(req, ctx.params),
      "api:orders:POST"
    );

    const db = getAdminDB();
    const user = await getUserFromRequest(req as unknown as Request);
    const body = (await req.json()) as CreateOrderBody;

    const type: OrderType = (["dine_in", "takeaway", "delivery"].includes(String(body.type))
      ? body.type
      : "dine_in") as OrderType;

    // ──────────────────────────────────────────────────────────────────────
    // 1) Formato NUEVO (OPS): items + amounts
    // ──────────────────────────────────────────────────────────────────────
    if (Array.isArray(body.items) && body.items.length > 0 && body.amounts) {
      const items = normalizeOpsItems(body.items);
      const amounts = {
        subtotal: Number(body.amounts.subtotal || 0),
        tax: Number(body.amounts.tax || 0),
        serviceFee: Number(body.amounts.serviceFee || 0),
        discount: Number(body.amounts.discount || 0),
        tip: Number(body.amounts.tip || 0),
        total: Number(body.amounts.total || 0),
      };

      const currency = (body.currency || "GTQ").toUpperCase();
      const tableNumber = typeof body.tableNumber === "string" ? body.tableNumber.trim() : "";
      const notes = typeof body.notes === "string" ? body.notes.trim() : "";

      if (type === "dine_in" && !tableNumber) {
        return json({ error: "Para Dine-In se requiere número de mesa." }, 400);
      }
      if (!Number.isFinite(amounts.total) || amounts.total <= 0) {
        return json({ error: "Montos inválidos o total = 0." }, 400);
      }

      const now = FieldValue.serverTimestamp();
      const orderDoc: Record<string, any> = {
        tenantId,        // ✅ siempre persistir tenantId
        type,
        status: "placed",
        items,           // ← OPS lee items con addons/opciones
        amounts,         // ← totales en Q
        currency,        // ← por defecto GTQ
        tableNumber: tableNumber || null,
        notes: notes || null,
        meta: body.meta || {},
        deliveryAddress: body.deliveryAddress || null,
        contactPhone: body.contactPhone || null,
        createdAt: now,
        updatedAt: now,
        createdBy: user?.uid ? { uid: user.uid, email: (user as any).email ?? null } : null,
        userEmail: (user as any)?.email ?? null,
        channel: type === "delivery" ? "delivery" : "onsite",
        origin: "web",
      };

      const ordersCol = db.collection(`tenants/${tenantId}/orders`);
      const ref = await ordersCol.add(orderDoc);

      await ordersCol.doc(ref.id).collection("events").add({
        type: "order_created",
        at: FieldValue.serverTimestamp(),
        by: orderDoc.createdBy,
        payload: { status: "placed" },
      });

      const snap = await ref.get();
      return json({ ok: true, tenantId, order: { id: ref.id, ...snap.data() } }, 201);
    }

    // ──────────────────────────────────────────────────────────────────────
    // 2) Formato LEGACY (compat): lines/orderLines/cart/items "planos"
    // ──────────────────────────────────────────────────────────────────────
    const linesRaw =
      (Array.isArray(body.lines) && body.lines) ||
      (Array.isArray(body.items) && body.items) ||
      (Array.isArray(body.cart) && body.cart) ||
      (Array.isArray(body.orderLines) && body.orderLines) ||
      [];

    if (!linesRaw.length) return json({ error: "No lines provided" }, 400);

    if (type === "delivery" && !user) {
      return json({ error: "Auth required for delivery orders" }, 401);
    }

    const safeLines = linesRaw.map((l: any) => {
      const qty = Number(l?.qty ?? l?.quantity ?? 1);
      const unit =
        Number.isFinite(l?.unitPriceCents) ? l?.unitPriceCents :
        Number.isFinite(l?.unitPrice) ? Math.round(Number(l?.unitPrice) * 100) :
        0;
      const tot =
        Number.isFinite(l?.totalCents) ? l?.totalCents :
        Number.isFinite(l?.total) ? Math.round(Number(l?.total) * 100) :
        qty * unit;

      return {
        itemId: String(l?.itemId ?? l?.menuItemId ?? l?.id),
        name: String(l?.name ?? l?.menuItemName ?? ""),
        qty: qty > 0 ? qty : 1,
        unitPriceCents: Number.isFinite(unit) ? unit : 0,
        totalCents: Number.isFinite(tot) ? tot : 0,
      } as LineInput;
    });

    const totalCents = safeLines.reduce((acc: number, l: any) => acc + (l.totalCents || 0), 0);

    const now = FieldValue.serverTimestamp();
    const orderDocLegacy: Record<string, any> = {
      tenantId, // ✅
      type,
      status: "placed",
      lines: safeLines,
      totals: { totalCents },
      createdAt: now,
      updatedAt: now,
      createdBy: user?.uid ? { uid: user.uid, email: (user as any).email ?? null } : null,
      userEmail: (user as any)?.email ?? null,
      origin: "web",
    };

    const ordersCol = db.collection(`tenants/${tenantId}/orders`);
    const ref = await ordersCol.add(orderDocLegacy);
    const snap = await ref.get();
    return json({ ok: true, tenantId, order: { id: ref.id, ...snap.data() } }, 201);
  } catch (e: any) {
    console.error("[POST /api/orders]", e);
    return json({ error: e?.message ?? "Server error" }, 500);
  }
}

/* -------------------- OPTIONS -------------------- */
export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
    },
  });
}
