// src/app/(tenant)/[tenant]/app/api/menu-items/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { NextRequest, NextResponse } from "next/server";
import { getAdminDB } from "@/lib/firebase/admin";
import { resolveTenantFromRequest, requireTenantId } from "@/lib/tenant/server";

const json = (d: unknown, s = 200) => NextResponse.json(d, { status: s });

// 📁 carpeta es [tenant] → params.tenant
type Ctx = { params: { tenant: string } };

/**
 * GET /api/menu-items
 * Lee SIEMPRE de tenants/{tenantId}/menuItems.
 *
 * Query:
 *  - limit?: number (<=200)
 *  - categoryName?: string
 *  - categoryId?: string
 *  - onlyAvailable=true|1   → sólo disponibles (por defecto: true)
 *  - all=1                  → incluye NO disponibles (anula onlyAvailable)
 *  - q?: string             → filtro de texto simple por nombre/descr. (en memoria)
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const { searchParams } = new URL(req.url);

  const limit = Math.min(Number(searchParams.get("limit") ?? 100), 200);

  // Filtros de categoría (compatibilidad con esquemas previos)
  const categoryName = searchParams.get("categoryName") || undefined;
  const categoryId = searchParams.get("categoryId") || undefined;

  // Disponibilidad: por defecto SÓLO disponibles
  const includeAll = searchParams.get("all") === "1";
  const onlyAvailableParam =
    searchParams.get("onlyAvailable") === "1" ||
    searchParams.get("onlyAvailable") === "true";
  const filterOnlyAvailable = includeAll ? false : (onlyAvailableParam || true);

  const qText = (searchParams.get("q") || "").toLowerCase().trim();

  // 🔐 tenant
  const tenantId = requireTenantId(
    resolveTenantFromRequest(req, ctx.params),
    "api:menu-items:GET"
  );

  const db = getAdminDB();
  const colPath = `tenants/${tenantId}/menuItems`;

  try {
    // Intento principal con filtros en Firestore (sin orderBy para evitar índices compuestos)
    let qRef = db.collection(colPath) as FirebaseFirestore.Query;

    if (filterOnlyAvailable) qRef = qRef.where("isAvailable", "==", true);
    if (categoryName) qRef = qRef.where("categoryName", "==", categoryName);
    if (categoryId) qRef = qRef.where("categoryId", "==", categoryId);

    qRef = qRef.limit(limit);

    const snap = await qRef.get();
    let items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

    // Filtro de texto en memoria
    if (qText) {
      items = items.filter((it: any) => {
        const name = String(it?.name || "").toLowerCase();
        const desc = String(it?.description || "").toLowerCase();
        return name.includes(qText) || desc.includes(qText);
      });
    }

    // Orden en memoria: sortOrder asc, luego name asc
    items.sort(
      (a: any, b: any) =>
        (Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0)) ||
        String(a.name ?? "").localeCompare(String(b.name ?? ""))
    );

    return json({ ok: true, items, nextCursor: null });
  } catch (e: any) {
    // Fallback cuando falta índice o hay precondición fallida
    const isIndexIssue =
      e?.code === 9 ||
      e?.code === "failed-precondition" ||
      (e?.message ?? "").includes("FAILED_PRECONDITION");

    if (!isIndexIssue) {
      console.error("[GET /menu-items]", e);
      return json({ error: e?.message ?? "Internal error" }, 500);
    }

    try {
      // Fallback: sin where (o con los mínimos) y filtrar en memoria
      const snap = await db.collection(colPath).limit(500).get(); // buffer más amplio
      let items = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));

      if (filterOnlyAvailable) {
        items = items.filter((it: any) => it?.isAvailable !== false);
      }
      if (categoryName) {
        items = items.filter((it: any) => it?.categoryName === categoryName);
      }
      if (categoryId) {
        items = items.filter((it: any) => it?.categoryId === categoryId);
      }
      if (qText) {
        items = items.filter((it: any) => {
          const name = String(it?.name || "").toLowerCase();
          const desc = String(it?.description || "").toLowerCase();
          return name.includes(qText) || desc.includes(qText);
        });
      }

      // Orden en memoria
      items.sort(
        (a: any, b: any) =>
          (Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0)) ||
          String(a.name ?? "").localeCompare(String(b.name ?? ""))
      );

      // Respeta el limit al final del pipeline de fallback
      items = items.slice(0, limit);

      return new NextResponse(JSON.stringify({ ok: true, items, nextCursor: null }), {
        status: 200,
        headers: {
          "x-firestore-index-fallback": "1",
          "content-type": "application/json",
        },
      });
    } catch (e2: any) {
      console.error("[GET /menu-items fallback]", e2);
      return json({ error: e2?.message ?? "Internal error" }, 500);
    }
  }
}
