// src/app/api/menu/[id]/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/firebase/admin";
import { FieldValue } from "firebase-admin/firestore";
import { getUserFromRequest } from "@/lib/server/auth";

const json = (d: unknown, s = 200) => NextResponse.json(d, { status: s });

/* -------------------- Helpers -------------------- */

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function toStringOrNull(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  if (typeof v === "string") return v.trim();
  return String(v);
}

function toNumberOrNull(v: unknown): number | null {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toBooleanOrNull(v: unknown): boolean | null {
  if (v === undefined || v === null || v === "") return null;
  if (typeof v === "boolean") return v;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (["true", "1", "yes", "y"].includes(s)) return true;
    if (["false", "0", "no", "n"].includes(s)) return false;
  }
  if (typeof v === "number") return v !== 0;
  return null;
}

function slugify(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}

function ensureIsAdmin(user: any): boolean {
  if (!user) return false;
  // Acepta role: 'admin' o claims.admin === true
  if (user.role && user.role === "admin") return true;
  if (user.claims && user.claims.admin === true) return true;
  return false;
}

/* -------------------- Handlers -------------------- */

/** ---------- PATCH /api/menu/:id ---------- */
export async function PATCH(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getUserFromRequest(req);
    const isAdmin = ensureIsAdmin(user);
    if (!isAdmin) return json({ error: "Unauthorized" }, 401);

    if (!((req.headers.get("content-type") || "").includes("application/json"))) {
      return json({ error: "Content-Type debe ser application/json" }, 415);
    }

    const body = await req.json().catch(() => ({}));

    // Construir actualización parcial
    const update: Record<string, any> = { updatedAt: FieldValue.serverTimestamp() };

    if (body.hasOwnProperty("name") && isNonEmptyString(body.name)) {
      update.name = String(body.name).trim();
      // Si no envían slug explícito, recalcular (opcional)
      if (!isNonEmptyString(body.slug)) {
        update.slug = slugify(update.name);
      }
    }

    if (body.hasOwnProperty("description")) {
      update.description = toStringOrNull(body.description);
    }

    if (body.hasOwnProperty("price")) {
      const price = toNumberOrNull(body.price);
      update.price = price;
      // si priceCents no viene, lo sincronizamos
      if (!body.hasOwnProperty("priceCents")) {
        update.priceCents = price != null ? Math.round(price * 100) : null;
      }
    }

    if (body.hasOwnProperty("priceCents")) {
      const priceCents = toNumberOrNull(body.priceCents);
      update.priceCents = priceCents;
      // si price no viene, lo sincronizamos
      if (!body.hasOwnProperty("price")) {
        update.price = priceCents != null ? priceCents / 100 : null;
      }
    }

    if (body.hasOwnProperty("currency")) {
      const currency = toStringOrNull(body.currency)?.toUpperCase() ?? null;
      update.currency = currency;
    }

    if (body.hasOwnProperty("imageUrl")) {
      update.imageUrl = toStringOrNull(body.imageUrl);
    }

    if (body.hasOwnProperty("isActive")) {
      update.isActive = toBooleanOrNull(body.isActive);
    }

    if (body.hasOwnProperty("categoryId")) {
      update.categoryId = toStringOrNull(body.categoryId);
    }

    if (body.hasOwnProperty("subcategoryId")) {
      update.subcategoryId = toStringOrNull(body.subcategoryId);
    }

    if (body.hasOwnProperty("sortOrder")) {
      update.sortOrder = toNumberOrNull(body.sortOrder) ?? 0;
    }

    if (body.hasOwnProperty("slug")) {
      const s = toStringOrNull(body.slug);
      update.slug = s && s.length > 0 ? slugify(s) : undefined;
    }

    // Permitir conservar otros campos arbitrarios:
    if (body && typeof body === "object") {
      for (const [k, v] of Object.entries(body as Record<string, unknown>)) {
        if (
          [
            "name",
            "description",
            "price",
            "priceCents",
            "currency",
            "imageUrl",
            "isActive",
            "categoryId",
            "subcategoryId",
            "sortOrder",
            "slug",
          ].includes(k)
        ) continue;
        // Solo incluir si no duplicamos clave “protegida”
        if (!Object.prototype.hasOwnProperty.call(update, k)) {
          update[k] = v;
        }
      }
    }

    // Usar `menuItems`
    const ref = db.collection("menuItems").doc(params.id);
    const snap = await ref.get();
    if (!snap.exists) return json({ error: "Not found" }, 404);

    await ref.update(update);
    const updated = await ref.get();
    return json({ ok: true, item: { id: params.id, ...updated.data() } }, 200);
  } catch (e: any) {
    console.error("[PATCH /api/menu/:id]", e);
    return json({ error: e?.message ?? "Server error" }, 500);
  }
}

/** ---------- DELETE /api/menu/:id ---------- */
export async function DELETE(
  req: NextRequest,
  { params }: { params: { id: string } }
) {
  try {
    const user = await getUserFromRequest(req);
    const isAdmin = ensureIsAdmin(user);
    if (!isAdmin) return json({ error: "Unauthorized" }, 401);

    // Usar `menuItems`
    const ref = db.collection("menuItems").doc(params.id);
    const snap = await ref.get();
    if (!snap.exists) return json({ error: "Not found" }, 404);

    await ref.delete();
    return json({ ok: true }, 200);
  } catch (e: any) {
    console.error("[DELETE /api/menu/:id]", e);
    return json({ error: e?.message ?? "Server error" }, 500);
  }
}

/** (Opcional) Preflight para CORS si llamas desde otros orígenes */
export function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Methods": "PATCH,DELETE,OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
      "Access-Control-Max-Age": "86400",
    },
  });
}
