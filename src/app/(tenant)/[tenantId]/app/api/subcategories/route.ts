// src/app/(tenant)/[tenant]/app/api/subcategories/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/server/auth";
import { FieldValue } from "firebase-admin/firestore";
import { SubcategoryCreateSchema } from "@/lib/validators/subcategories";
import { slugify } from "@/lib/utils/slug";

// ✅ Tenant helpers (tu import actualizado)
import { resolveTenantFromRequest, requireTenantId } from "@/lib/tenant/server";

// ✅ Firestore Admin tenant-aware
import { tColAdmin } from "@/lib/db_admin";

const json = (d: unknown, s = 200) => NextResponse.json(d, { status: s });

function isAdmin(user: any) {
  return (
    user?.role === "admin" ||
    user?.isAdmin === true ||
    user?.claims?.admin === true
  );
}

/** =========================
 * GET /api/subcategories
 * Query params:
 *  - all=1 (incluye inactivas), por defecto solo activas
 *  - categoryId=... (filtrar por categoría)
 *  - limit=...
 * ========================== */
export async function GET(
  req: NextRequest,
  ctx: { params: { tenant: string } }
) {
  try {
    const tenantId = requireTenantId(
      resolveTenantFromRequest(req, ctx?.params),
      "api:/subcategories:GET"
    );

    const { searchParams } = new URL(req.url);
    const includeAll = searchParams.get("all") === "1";
    const categoryId = (searchParams.get("categoryId") || "").trim();

    const rawLimit = Number(searchParams.get("limit"));
    const limit =
      Number.isFinite(rawLimit) && rawLimit > 0
        ? Math.min(rawLimit, 500)
        : 200;

    const col = tColAdmin("subcategories", tenantId);

    // Regla: si hay filtros, evitamos orderBy en la consulta para no requerir índice compuesto.
    const hasFilter = !!categoryId || !includeAll;

    if (!hasFilter) {
      // Sin filtros → ordenamos en Firestore
      const snap = await col.orderBy("sortOrder", "asc").limit(limit).get();
      const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
      return json({ items, count: items.length });
    }

    // Con filtros → build query con where y ordenamos en memoria
    let q: FirebaseFirestore.Query = col as unknown as FirebaseFirestore.Query;
    if (categoryId) q = q.where("categoryId", "==", categoryId);
    if (!includeAll) q = q.where("isActive", "==", true);

    const snap = await q.limit(1000).get();
    const items = snap.docs
      .map((d) => ({ id: d.id, ...d.data() }))
      .sort((a: any, b: any) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      .slice(0, limit);

    return json({ items, count: items.length });
  } catch (err: any) {
    console.error("GET /subcategories error:", err);
    return json({ error: "Internal error" }, 500);
  }
}

/** =========================
 * POST /api/subcategories
 * Crea una subcategoría (admin)
 * ========================== */
export async function POST(
  req: NextRequest,
  ctx: { params: { tenant: string } }
) {
  try {
    // const rl = await rateLimitByIP(req, { key: "subcategories:POST", limit: 30, windowMs: 60_000 });
    // if (!rl.ok) return json({ error: "Too many requests" }, 429);

    // Admin
    const user = await getUserFromRequest(req);
    if (!user || !isAdmin(user)) {
      return json({ error: "Forbidden" }, 403);
    }

    const tenantId = requireTenantId(
      resolveTenantFromRequest(req, ctx?.params),
      "api:/subcategories:POST"
    );

    const ct = req.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      return json({ error: "Content-Type debe ser application/json" }, 415);
    }

    const raw = await req.json();
    const parsed = SubcategoryCreateSchema.safeParse(raw);
    if (!parsed.success) {
      return json({ error: "Datos inválidos", details: parsed.error.format() }, 422);
    }

    const data = parsed.data;
    const categoryId = data.categoryId.trim();

    // Verificar que la categoría exista (tenant-scoped)
    const catRef = tColAdmin("categories", tenantId).doc(categoryId);
    const catSnap = await catRef.get();
    if (!catSnap.exists) {
      return json({ error: "categoryId no existe" }, 422);
    }

    const name = data.name.trim();
    const slug = data.slug?.trim() || slugify(name);

    // Unicidad por (categoryId, slug) dentro del tenant
    const dup = await tColAdmin("subcategories", tenantId)
      .where("categoryId", "==", categoryId)
      .where("slug", "==", slug)
      .limit(1)
      .get();
    if (!dup.empty) {
      return json({ error: "Ya existe una subcategoría con ese slug en la categoría" }, 409);
    }

    const now = FieldValue.serverTimestamp();
    const docRef = tColAdmin("subcategories", tenantId).doc();

    const payload = {
      id: docRef.id,
      tenantId,                 // 👈 siempre scopiado
      categoryId,
      name,
      slug,
      description: data.description ?? "",
      isActive: data.isActive ?? true,
      sortOrder: data.sortOrder ?? 0,
      createdAt: now,
      updatedAt: now,
    };

    await docRef.set(payload);
    return json({ ok: true, item: payload }, 201);
  } catch (err: any) {
    console.error("POST /subcategories error:", err);
    return json({ error: "Internal error" }, 500);
  }
}
