// src/app/(tenant)/[tenant]/app/api/orders/[id]/payment/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { getAdminDB, adminAuth } from "@/lib/firebase/admin";
import { resolveTenantFromRequest, requireTenantId } from "@/lib/tenant/server";

/** ===== Auth helper (Bearer) usando Admin SDK central ===== */
async function verifyAuth(req: NextRequest) {
  const auth = req.headers.get("authorization") || req.headers.get("Authorization");
  if (!auth || !auth.startsWith("Bearer ")) return null;
  const token = auth.slice("Bearer ".length).trim();
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    return decoded; // { uid, ...customClaims }
  } catch {
    return null;
  }
}

// 📁 carpeta es [tenant] → params.tenant
type Ctx = { params: { tenant: string; id: string } };

/** ========== PATCH /api/orders/:id/payment ========== */
export async function PATCH(req: NextRequest, ctx: Ctx) {
  // 🔐 tenant
  const tenantId = requireTenantId(
    resolveTenantFromRequest(req, ctx.params),
    "api:orders/[id]/payment:PATCH"
  );

  // 🔐 auth
  const decoded = await verifyAuth(req);
  if (!decoded) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Autorización mínima: admin o cashier (custom claims)
  const isAdmin = !!(decoded as any).admin || (Array.isArray((decoded as any).roles) && (decoded as any).roles.includes("admin"));
  const isCashier = !!(decoded as any).cashier || (Array.isArray((decoded as any).roles) && (decoded as any).roles.includes("cashier"));
  if (!isAdmin && !isCashier) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const { id } = ctx.params;
  if (!id) return NextResponse.json({ error: "Missing order id" }, { status: 400 });

  let body: any = null;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const updates: Record<string, any> = {};
  if (typeof body?.status === "string" && body.status.trim() !== "") {
    updates["payment.status"] = String(body.status).trim();
  }
  if (typeof body?.provider === "string" && body.provider.trim() !== "") {
    updates["payment.provider"] = String(body.provider).trim();
  }
  if (Number.isFinite(Number(body?.amount))) {
    updates["payment.amount"] = Number(body.amount);
  }
  if (typeof body?.currency === "string" && body.currency.trim() !== "") {
    updates["payment.currency"] = String(body.currency).trim();
  }
  // Siempre marcamos updatedAt del bloque de payment
  updates["payment.updatedAt"] = FieldValue.serverTimestamp();
  // Persistimos tenantId por consistencia
  updates["tenantId"] = tenantId;

  if (Object.keys(updates).length === 1) {
    // Solo trae updatedAt => no hay cambios útiles
    return NextResponse.json({ ok: false, reason: "No payment fields provided." }, { status: 400 });
  }

  // Idempotencia opcional por header (no estrictamente necesario)
  // const idemKey = req.headers.get("x-idempotency-key") || null;

  try {
    const db = getAdminDB();
    const ref = db.collection(`tenants/${tenantId}/orders`).doc(id);

    // Validación básica: que exista la orden
    const snap = await ref.get();
    if (!snap.exists) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    await ref.update(updates);

    // Devuelve el bloque payment resultante
    const after = await ref.get();
    const payment = (after.data() || {}).payment || null;

    return NextResponse.json({ ok: true, tenantId, orderId: id, payment }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Update failed" }, { status: 500 });
  }
}

/** Opcional: rechazar otros métodos */
export async function GET() {
  return NextResponse.json({ error: "Method Not Allowed" }, { status: 405 });
}
export async function POST() {
  return NextResponse.json({ error: "Method Not Allowed" }, { status: 405 });
}
export async function PUT() {
  return NextResponse.json({ error: "Method Not Allowed" }, { status: 405 });
}
export async function DELETE() {
  return NextResponse.json({ error: "Method Not Allowed" }, { status: 405 });
}
