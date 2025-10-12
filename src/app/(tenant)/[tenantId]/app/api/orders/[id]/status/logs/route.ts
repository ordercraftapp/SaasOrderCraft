// src/app/(tenant)/[tenant]/app/api/orders/[id]/status/logs/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getAdminDB } from "@/lib/firebase/admin";
import { getUserFromRequest } from "@/lib/server/auth";
import { resolveTenantFromRequest, requireTenantId } from "@/lib/tenant/server";

const json = (d: unknown, s = 200) => NextResponse.json(d, { status: s });

type Ctx = { params: { tenant: string; id: string } };

export async function GET(req: NextRequest, ctx: Ctx) {
  try {
    const user = await getUserFromRequest(req);

    // ✅ cálculo laxo que evita el rojo de TS
    const isAdmin =
      (user as any)?.role === "admin" ||
      (user as any)?.claims?.admin === true ||
      (Array.isArray((user as any)?.roles) && (user as any).roles.includes("admin"));

    if (!user) return json({ error: "Unauthorized" }, 401);
    if (!isAdmin) return json({ error: "Forbidden" }, 403);

    const tenantId = requireTenantId(
      resolveTenantFromRequest(req, ctx.params),
      "api:orders/[id]/status/logs:GET"
    );

    const { searchParams } = new URL(req.url);
    const limit = Math.min(Number(searchParams.get("limit") ?? 1), 20);

    const db = getAdminDB();
    const orderRef = db.collection(`tenants/${tenantId}/orders`).doc(ctx.params.id);

    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) return json({ error: "Not found" }, 404);

    const logsSnap = await orderRef
      .collection("status_log")
      .orderBy("at", "desc")
      .limit(limit)
      .get();

    const items = logsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return json({ ok: true, tenantId, items });
  } catch (e: any) {
    console.error("[GET /api/orders/:id/status/logs]", e);
    return json({ error: e?.message ?? "Server error" }, 500);
  }
}
