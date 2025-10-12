// src/app/(tenant)/[tenant]/app/api/subcategories/[id]/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/server/auth";
import { FieldValue } from "firebase-admin/firestore";
import { SubcategoryUpdateSchema } from "@/lib/validators/subcategories";
import { slugify } from "@/lib/utils/slug";

// ✅ tenant helpers
import { resolveTenantFromRequest, requireTenantId } from "@/lib/tenant/server";

// ✅ Firestore Admin (tenant-aware)
import { tColAdmin } from "@/lib/db_admin";

const json = (d: unknown, s = 200) => NextResponse.json(d, { status: s });

function isAdmin(user: any) {
  return (
    user?.role === "admin" ||
    user?.isAdmin === true ||
    user?.claims?.admin === true
  );
}

async function requireAdmin(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user || !isAdmin(user)) {
    return { ok: false as const, res: json({ error: "Forbidden" }, 403) };
  }
  return { ok: true as const, user };
}

export async function PATCH(
  req: NextRequest,
  ctx: { params: { tenant: string; id: string } }
) {
  try {
    const adminCheck = await requireAdmin(req);
    if (!adminCheck.ok) return adminCheck.res;

    const tenantId = requireTenantId(
      resolveTenantFromRequest(req, ctx?.params),
      "api:/subcategories/[id]:PATCH"
    );

    const ct = req.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      return json({ error: "Content-Type debe ser application/json" }, 415);
    }

    const { id } = ctx.params;
    const ref = tColAdmin("subcategories", tenantId).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return json({ error: "No encontrado" }, 404);

    const current = (snap.data() as any) || {};

    const raw = await req.json();
    const parsed = SubcategoryUpdateSchema.safeParse(raw);
    if (!parsed.success) {
      return json({ error: "Datos inválidos", details: parsed.error.format() }, 422);
    }

    const data = parsed.data;

    // Verificar categoryId si cambia (scope tenant)
    let targetCategoryId = data.categoryId?.trim() || current.categoryId;
    if (data.categoryId && targetCategoryId !== current.categoryId) {
      const catRef = tColAdmin("categories", tenantId).doc(targetCategoryId);
      const catSnap = await catRef.get();
      if (!catSnap.exists) return json({ error: "categoryId no existe" }, 422);
    }

    // Resolver slug
    let nextSlug = data.slug?.trim();
    if (!nextSlug && typeof data.name === "string") nextSlug = slugify(data.name);

    // Validar unicidad por (categoryId, slug) dentro del tenant si cambia
    const willCheckUniq =
      (nextSlug && nextSlug !== current.slug) ||
      (targetCategoryId && targetCategoryId !== current.categoryId);

    if (willCheckUniq && nextSlug) {
      const dup = await tColAdmin("subcategories", tenantId)
        .where("categoryId", "==", targetCategoryId)
        .where("slug", "==", nextSlug)
        .limit(1)
        .get();

      if (!dup.empty && dup.docs[0].id !== id) {
        return json({ error: "Ya existe una subcategoría con ese slug en la categoría" }, 409);
      }
    }

    const updatePayload: Record<string, any> = {
      updatedAt: FieldValue.serverTimestamp(),
      tenantId, // refuerzo de scope
    };
    if (data.name !== undefined) updatePayload.name = data.name.trim();
    if (nextSlug !== undefined) updatePayload.slug = nextSlug;
    if (data.description !== undefined)
      updatePayload.description = data.description?.trim() ?? "";
    if (data.isActive !== undefined) updatePayload.isActive = data.isActive;
    if (data.sortOrder !== undefined) updatePayload.sortOrder = data.sortOrder;
    if (targetCategoryId !== undefined) updatePayload.categoryId = targetCategoryId;

    await ref.update(updatePayload);
    const updated = await ref.get();

    return json({ ok: true, item: { id, ...updated.data() } });
  } catch (err: any) {
    console.error("PATCH /subcategories/[id] error:", err);
    return json({ error: "Internal error" }, 500);
  }
}

export async function DELETE(
  req: NextRequest,
  ctx: { params: { tenant: string; id: string } }
) {
  try {
    const adminCheck = await requireAdmin(req);
    if (!adminCheck.ok) return adminCheck.res;

    const tenantId = requireTenantId(
      resolveTenantFromRequest(req, ctx?.params),
      "api:/subcategories/[id]:DELETE"
    );

    const { searchParams } = new URL(req.url);
    const hard = ["1", "true", "yes"].includes(
      (searchParams.get("hard") || "").toLowerCase()
    );

    const { id } = ctx.params;
    const ref = tColAdmin("subcategories", tenantId).doc(id);
    const snap = await ref.get();
    if (!snap.exists) return json({ error: "No encontrado" }, 404);

    if (hard) {
      // (Opcional) Bloquear si hay productos vinculados antes de borrar duro
      await ref.delete();
      return json({ ok: true, deleted: id });
    } else {
      await ref.update({
        isActive: false,
        tenantId, // refuerzo
        updatedAt: FieldValue.serverTimestamp(),
      });
      return json({ ok: true, softDeleted: id });
    }
  } catch (err: any) {
    console.error("DELETE /subcategories/[id] error:", err);
    return json({ error: "Internal error" }, 500);
  }
}
