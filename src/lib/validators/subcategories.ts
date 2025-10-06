// src/lib/validators/subcategories.ts
import { z } from "zod";

const noHTML = z
  .string()
  .trim()
  .min(1, "Requerido")
  .max(80, "Máximo 80 caracteres")
  .refine((v) => !/[<>]/.test(v), "Caracteres inválidos: < >");

export const SubcategoryCreateSchema = z.object({
  categoryId: z.string().trim().min(1, "categoryId requerido"),
  name: noHTML,
  slug: z.string().trim().toLowerCase().max(100).optional(),
  description: z.string().trim().max(200).optional(),
  isActive: z.boolean().optional().default(true),
  sortOrder: z.number().int().min(0).optional().default(0),
});

export const SubcategoryUpdateSchema = z.object({
  categoryId: z.string().trim().min(1).optional(), // permitir mover de categoría (opcional)
  name: noHTML.optional(),
  slug: z.string().trim().toLowerCase().max(100).optional(),
  description: z.string().trim().max(200).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export type SubcategoryCreateInput = z.infer<typeof SubcategoryCreateSchema>;
export type SubcategoryUpdateInput = z.infer<typeof SubcategoryUpdateSchema>;
