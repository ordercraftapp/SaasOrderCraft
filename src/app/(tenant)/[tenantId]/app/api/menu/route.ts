// src/app/api/menu/route.ts
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

type CreateBody = {
  name: string;
  description?: string | null;
  price?: number | null;        // opcional si usas priceCents
  priceCents?: number | null;
  currency?: string | null;     // ej "USD", "GTQ"
  imageUrl?: string | null;
  isActive?: boolean | null;
  categoryId?: string | null;
  subcategoryId?: string | null;
  sortOrder?: number | null;
  slug?: string | null;
  // cualquier otro campo queda permitido y se conservará
  [k: string]: unknown;
};

function buildCreateDoc(raw: any):
  | { ok: true; doc: Record<string, any> }
  | { ok: false; error: string } {
  const name = isNonEmptyString(raw?.name) ? raw.name.trim() : "";
  if (!name) return { ok: false, error: "El campo 'name' es requerido." };

  const description = toStringOrNull(raw?.description);
  const price = toNumberOrNull(raw?.price);
  const priceCents = toNumberOrNull(raw?.priceCents);
  const currency = toStringOrNull(raw?.currency)?.toUpperCase() ?? null;
  const imageUrl = toStringOrNull(raw?.imageUrl);
  const isActive = toBooleanOrNull(raw?.isActive);
  const categoryId = toStringOrNull(raw?.categoryId);
  const subcategoryId = toStringOrNull(raw?.subcategoryId);
  const sortOrder = toNumberOrNull(raw?.sortOrder);

  // slug: si viene vacío, generar desde name
  const slugInput = toStringOrNull(raw?.slug);
  const slug = slugify(slugInput && slugInput.length > 0 ? slugInput : name);

  // permitir campos extra, pero sin pisar los protegidos
  const extras: Record<string, any> = {};
  if (raw && typeof raw === "object") {
    for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
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
      extras[k] = v;
    }
  }

  const nowFields = {
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };

  const doc: Record<string, any> = {
    name,
    description: description ?? null,
    price: price ?? null,
    priceCents: priceCents ?? (price != null ? Math.round(price * 100) : null),
    currency: currency ?? null,
    imageUrl: imageUrl ?? null,
    isActive: isActive ?? true,
    categoryId: categoryId ?? null,
    subcategoryId: subcategoryId ?? null,
    sortOrder: sortOrder ?? 0,
    slug,
    ...extras,
    ...nowFields,
  };

  return { ok: true, doc };
}

function ensureIsAdmin(user: any): boolean {
  if (!user) return false;
  // Acepta role: 'admin' o claims.admin === true
  if (user.role && user.role === "admin") return true;
  if (user.claims && user.claims.admin === true) return true;
  return false;
}

/* -------------------- Handlers -------------------- */

/** ---------- GET /api/menu ---------- */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const limitParam = parseInt(searchParams.get("limit") || "20", 10);
    const limit = Number.isFinite(limitParam) ? Math.min(Math.max(limitParam, 1), 100) : 20;

    // Leer desde `menuItems`
    const snap = await db
      .collection("menuItems")
      .orderBy("createdAt", "desc")
      .limit(limit)
      .get();

    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return json({ ok: true, items, nextCursor: null }, 200);
  } catch (e: any) {
    console.error("[GET /api/menu]", e);
    return json({ error: e?.message ?? "Server error" }, 500);
  }
}

/** ---------- POST /api/menu ---------- */
export async function POST(req: NextRequest) {
  try {
    const user = await getUserFromRequest(req);
    const isAdmin = ensureIsAdmin(user);
    if (!isAdmin) return json({ error: "Unauthorized" }, 401);

    if (!((req.headers.get("content-type") || "").includes("application/json"))) {
      return json({ error: "Content-Type debe ser application/json" }, 415);
    }

    const body: CreateBody = await req.json().catch(() => ({} as any));
    const built = buildCreateDoc(body);
    if (!built.ok) {
      return json(
        { error: built.error, issues: { fieldErrors: { _root: [built.error] } } },
        422
      );
    }

    // Escribir en `menuItems`
    const ref = await db.collection("menuItems").add(built.doc);
    const snap = await ref.get();
    const item = { id: ref.id, ...snap.data() };

    return json({ ok: true, item }, 201);
  } catch (e: any) {
    console.error("[POST /api/menu]", e);
    return json({ error: e?.message ?? "Server error" }, 500);
  }
}

/** (Opcional) Preflight para CORS si llamas desde otros orígenes */
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
