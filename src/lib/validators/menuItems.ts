// src/lib/validators/menuItems.ts
import { z } from "zod";

const noHTML80 = z.string().trim().min(1).max(80).refine(v => !/[<>]/.test(v), "Caracteres inválidos");
const noHTML200 = z.string().trim().max(200).refine(v => !/[<>]/.test(v), "Caracteres inválidos");
const noHTML500 = z.string().trim().max(500).refine(v => !/[<>]/.test(v), "Caracteres inválidos");

export const MenuItemCreateSchema = z.object({
  categoryId: z.string().trim().min(1, "categoryId requerido"),
  subcategoryId: z.string().trim().min(1).optional(), // opcional
  name: noHTML80,
  slug: z.string().trim().toLowerCase().max(100).optional(),
  description: noHTML500.optional(),
  price: z.number().nonnegative().finite(),
  currency: z.string().trim().toUpperCase().length(3).default("USD"),
  isActive: z.boolean().optional().default(true),
  isAvailable: z.boolean().optional().default(true),
  sortOrder: z.number().int().min(0).optional().default(0),
  tags: z.array(noHTML80).max(15).optional(),
  imageUrl: z.string().url().optional(), // 1 imagen por ahora
  prepMinutes: z.number().int().min(0).max(240).optional(), // tiempo de preparación aprox.
});

export const MenuItemUpdateSchema = z.object({
  categoryId: z.string().trim().min(1).optional(),
  subcategoryId: z.string().trim().min(1).nullable().optional(), // permite quitarla con null
  name: noHTML80.optional(),
  slug: z.string().trim().toLowerCase().max(100).optional(),
  description: noHTML500.optional(),
  price: z.number().nonnegative().finite().optional(),
  currency: z.string().trim().toUpperCase().length(3).optional(),
  isActive: z.boolean().optional(),
  isAvailable: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
  tags: z.array(noHTML80).max(15).optional(),
  imageUrl: z.string().url().nullable().optional(),
  prepMinutes: z.number().int().min(0).max(240).optional(),
});

export type MenuItemCreateInput = z.infer<typeof MenuItemCreateSchema>;
export type MenuItemUpdateInput = z.infer<typeof MenuItemUpdateSchema>;
