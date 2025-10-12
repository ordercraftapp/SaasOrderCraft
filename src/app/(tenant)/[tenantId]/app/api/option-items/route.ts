// src/app/(tenant)/[tenant]/app/api/option-items/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getAdminDB } from "@/lib/firebase/admin";
import { resolveTenantFromRequest, requireTenantId } from "@/lib/tenant/server";

const json = (d: unknown, s = 200) => NextResponse.json(d, { status: s });

// 📁 carpeta es [tenant] → params.tenant
type Ctx = { params: { tenant: string } };

/**
 * GET /api/option-items?groupId=ID
 * Query:
 *  - groupId: string (requerido)
 *  - all=1   → incluye inactivos (por defecto solo activos)
 *  - limit?: number (<=200)
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const { searchParams } = new URL(req.url);
  const groupId = searchParams.get("groupId");
  const includeAll = searchParams.get("all") === "1";
  const limit = Math.min(Number(searchParams.get("limit") ?? 100), 200);

  if (!groupId) return json({ error: "groupId requerido" }, 400);

  // 🔐 tenant
  const tenantId = requireTenantId(
    resolveTenantFromRequest(req, ctx.params),
    "api:option-items:GET"
  );

  const db = getAdminDB();
  const colPath = `tenants/${tenantId}/optionItems`;

  try {
    let qRef = db
      .collection(colPath)
      .where("groupId", "==", groupId) as FirebaseFirestore.Query;

    if (!includeAll) qRef = qRef.where("isActive", "==", true);

    // Puede requerir índice compuesto
    qRef = qRef.orderBy("sortOrder", "asc").limit(limit);

    const snap = await qRef.get();
    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));

    return json({ items, count: items.length });
  } catch (e: any) {
    const isIndexIssue =
      e?.code === 9 ||
      e?.code === "failed-precondition" ||
      (e?.message ?? "").includes("FAILED_PRECONDITION");

    if (!isIndexIssue) {
      console.error("[GET /option-items]", e);
      return json({ error: e?.message ?? "Internal error" }, 500);
    }

    // Fallback: sin orderBy, ordenar en memoria
    try {
      let qRef = db
        .collection(colPath)
        .where("groupId", "==", groupId) as FirebaseFirestore.Query;

      if (!includeAll) qRef = qRef.where("isActive", "==", true);

      const snap = await qRef.limit(limit).get();
      const items = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as any))
        .sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0));

      return new NextResponse(JSON.stringify({ items, count: items.length }), {
        status: 200,
        headers: {
          "x-firestore-index-fallback": "1",
          "content-type": "application/json",
        },
      });
    } catch (e2: any) {
      console.error("[GET /option-items fallback]", e2);
      return json({ error: e2?.message ?? "Internal error" }, 500);
    }
  }
}
