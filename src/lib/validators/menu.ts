import { MenuItemInput } from "@/types/menu";

//src/lib/validators/manu.ts
export function validateMenuItemInput(body: any): { ok: true; data: MenuItemInput } | { ok: false; error: string } {
  if (typeof body !== "object" || body === null) return { ok: false, error: "Invalid payload" };

  const { name, price, categoryId, categoryName, description, imageUrl, isAvailable } = body;

  if (typeof name !== "string" || name.trim().length < 2) return { ok: false, error: "name must be at least 2 chars" };
  if (typeof price !== "number" || !isFinite(price) || price <= 0) return { ok: false, error: "price must be > 0" };

  if (categoryId != null && typeof categoryId !== "string") return { ok: false, error: "categoryId must be string or null" };
  if (categoryName != null && typeof categoryName !== "string") return { ok: false, error: "categoryName must be string or null" };
  if (description != null && typeof description !== "string") return { ok: false, error: "description must be string or null" };
  if (imageUrl != null && typeof imageUrl !== "string") return { ok: false, error: "imageUrl must be string or null" };
  if (isAvailable != null && typeof isAvailable !== "boolean") return { ok: false, error: "isAvailable must be boolean" };

  return {
    ok: true,
    data: {
      name: name.trim(),
      price,
      categoryId: categoryId ?? null,
      categoryName: categoryName ?? null,
      description: description ?? null,
      imageUrl: imageUrl ?? null,
      isAvailable: isAvailable ?? true,
    },
  };
}
