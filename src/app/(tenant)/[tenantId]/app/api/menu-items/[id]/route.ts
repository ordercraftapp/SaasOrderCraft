// src/app/(tenant)/[tenant]/app/api/menu-items/[id]/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getAdminDB } from "@/lib/firebase/admin";
import { getUserFromRequest } from "@/lib/server/auth";
import { FieldValue } from "firebase-admin/firestore";
import { MenuItemUpdateSchema } from "@/lib/validators/menuItems";
import { slugify } from "@/lib/utils/slug";
// import { rateLimitByIP } from "@/lib/security/ratelimit";

// 🏷️ Tenancy helpers
import { resolveTenantFromRequest, requireTenantId } from "@/lib/tenant/server";

// Helpers JSON
const json = (d: unknown, s = 200) => NextResponse.json(d, { status: s });

// Roles mínimos (mantengo tu lógica)
function isAdmin(user: any) {
  return user?.role === "admin" || user?.isAdmin === true || user?.claims?.admin === true;
}
async function requireAdmin(req: NextRequest) {
  const user = await getUserFromRequest(req);
  if (!user || !isAdmin(user)) return { ok: false as const, res: json({ error: "Forbidden" }, 403) };
  return { ok: true as const, user };
}

// 📁 carpeta es [tenant] → params.tenant
type Ctx = { params: { tenant: string; id: string } };

export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    // const rl = await rateLimitByIP(req, { key: "menu-items:PATCH", limit: 60, windowMs: 60_000 });
    // if (!rl.ok) return json({ error: "Too many requests" }, 429);

    // 🔐 Auth + tenant
    const admin = await requireAdmin(req);
    if (!admin.ok) return admin.res;

    const tenantId = requireTenantId(
      resolveTenantFromRequest(req, ctx.params),
      "api:menu-items/[id]:PATCH"
    );

    const ct = req.headers.get("content-type") || "";
    if (!ct.includes("application/json")) {
      return json({ error: "Content-Type debe ser application/json" }, 415);
    }

    const db = getAdminDB();

    // 🔎 Lee el item del tenant
    const ref = db.collection(`tenants/${tenantId}/menuItems`).doc(ctx.params.id);
    const snap = await ref.get();
    if (!snap.exists) return json({ error: "No encontrado" }, 404);

    const current = snap.data() as any;

    // ✅ Valida input
    const raw = await req.json();
    const parsed = MenuItemUpdateSchema.safeParse(raw);
    if (!parsed.success) return json({ error: "Datos inválidos", details: parsed.error.format() }, 422);
    const data = parsed.data;

    // 🔗 Resolver categoryId destino (dentro del mismo tenant)
    let nextCategoryId = data.categoryId ?? current.categoryId;
    if (data.categoryId && data.categoryId !== current.categoryId) {
      const catSnap = await db.collection(`tenants/${tenantId}/categories`).doc(nextCategoryId).get();
      if (!catSnap.exists) return json({ error: "categoryId no existe" }, 422);
    }

    // 🔗 Resolver subcategoryId destino (puede venir null para quitarla)
    let nextSubcategoryId = data.subcategoryId === undefined ? current.subcategoryId : data.subcategoryId;
    if (nextSubcategoryId) {
      const subSnap = await db.collection(`tenants/${tenantId}/subcategories`).doc(nextSubcategoryId).get();
      if (!subSnap.exists) return json({ error: "subcategoryId no existe" }, 422);
      const sub = subSnap.data()!;
      if (sub.categoryId !== nextCategoryId) {
        return json({ error: "subcategoryId no pertenece a categoryId" }, 422);
      }
    }

    // 🏷️ Resolver slug
    let nextSlug = data.slug?.trim();
    if (!nextSlug && typeof data.name === "string") nextSlug = slugify(data.name);

    // 🔁 Unicidad por (categoryId, slug) dentro del tenant
    const slugChanged = !!nextSlug && nextSlug !== current.slug;
    const categoryChanged = nextCategoryId !== current.categoryId;

    if ((slugChanged || categoryChanged) && nextSlug) {
      const dup = await db
        .collection(`tenants/${tenantId}/menuItems`)
        .where("categoryId", "==", nextCategoryId)
        .where("slug", "==", nextSlug)
        .limit(1)
        .get();
      if (!dup.empty && dup.docs[0].id !== ctx.params.id) {
        return json({ error: "Ya existe un ítem con ese slug en la categoría" }, 409);
      }
    }

    // 🛠️ Payload de actualización — siempre grabar tenantId
    const updatePayload: Record<string, any> = {
      tenantId,
      updatedAt: FieldValue.serverTimestamp(),
    };
    if (data.name !== undefined) updatePayload.name = data.name.trim();
    if (nextSlug !== undefined) updatePayload.slug = nextSlug;
    if (data.description !== undefined) updatePayload.description = data.description?.trim() ?? "";
    if (data.price !== undefined) updatePayload.price = data.price;
    if (data.currency !== undefined) updatePayload.currency = data.currency;
    if (data.isActive !== undefined) updatePayload.isActive = data.isActive;
    if (data.isAvailable !== undefined) updatePayload.isAvailable = data.isAvailable;
    if (data.sortOrder !== undefined) updatePayload.sortOrder = data.sortOrder;
    if (data.tags !== undefined) updatePayload.tags = data.tags;
    if (data.imageUrl !== undefined) updatePayload.imageUrl = data.imageUrl ?? null;
    if (data.prepMinutes !== undefined) updatePayload.prepMinutes = data.prepMinutes;
    if (nextCategoryId !== undefined) updatePayload.categoryId = nextCategoryId;
    if (data.subcategoryId !== undefined) updatePayload.subcategoryId = nextSubcategoryId ?? null;

    await ref.update(updatePayload);
    const updated = await ref.get();

    // (opcional) auditoría
    try {
      await db.collection(`tenants/${tenantId}/_admin_audit`).add({
        type: "menuItem.updated",
        tenantId,
        at: new Date(),
        by: (admin as any)?.user?.uid ?? null,
        itemId: ctx.params.id,
        changes: Object.keys(updatePayload),
        origin: "api",
        path: "menu-items/[id]:PATCH",
      });
    } catch {}

    return json({ ok: true, item: { id: ctx.params.id, ...updated.data() } });
  } catch (err: any) {
    console.error("PATCH /menu-items/[id] error:", err);
    return json({ error: "Internal error" }, 500);
  }
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  try {
    // const rl = await rateLimitByIP(req, { key: "menu-items:DELETE", limit: 30, windowMs: 60_000 });
    // if (!rl.ok) return json({ error: "Too many requests" }, 429);

    // 🔐 Auth + tenant
    const admin = await requireAdmin(req);
    if (!admin.ok) return admin.res;

    const tenantId = requireTenantId(
      resolveTenantFromRequest(req, ctx.params),
      "api:menu-items/[id]:DELETE"
    );

    const db = getAdminDB();

    const { searchParams } = new URL(req.url);
    const hard = ["1", "true", "yes"].includes((searchParams.get("hard") || "").toLowerCase());

    // Leer item dentro del tenant
    const ref = db.collection(`tenants/${tenantId}/menuItems`).doc(ctx.params.id);
    const snap = await ref.get();
    if (!snap.exists) return json({ error: "No encontrado" }, 404);

    if (hard) {
      // Futuro: bloquear si hay pedidos abiertos que referencien este producto.
      await ref.delete();

      // auditoría
      try {
        await db.collection(`tenants/${tenantId}/_admin_audit`).add({
          type: "menuItem.deleted",
          tenantId,
          at: new Date(),
          by: (admin as any)?.user?.uid ?? null,
          itemId: ctx.params.id,
          mode: "hard",
          origin: "api",
          path: "menu-items/[id]:DELETE",
        });
      } catch {}

      return json({ ok: true, deleted: ctx.params.id });
    } else {
      await ref.update({ isActive: false, tenantId, updatedAt: FieldValue.serverTimestamp() });

      // auditoría
      try {
        await db.collection(`tenants/${tenantId}/_admin_audit`).add({
          type: "menuItem.deleted",
          tenantId,
          at: new Date(),
          by: (admin as any)?.user?.uid ?? null,
          itemId: ctx.params.id,
          mode: "soft",
          origin: "api",
          path: "menu-items/[id]:DELETE",
        });
      } catch {}

      return json({ ok: true, softDeleted: ctx.params.id });
    }
  } catch (err: any) {
    console.error("DELETE /menu-items/[id] error:", err);
    return json({ error: "Internal error" }, 500);
  }
}
