// src/lib/validators/categories.ts
import { z } from "zod";

// Reglas anti-inyección básicas: sin tags HTML
const noHTML = z
  .string()
  .trim()
  .min(1, "Requerido")
  .max(80, "Máximo 80 caracteres")
  .refine((v) => !/[<>]/.test(v), "Caracteres inválidos: < >");

export const CategoryCreateSchema = z.object({
  name: noHTML,
  slug: z.string().trim().toLowerCase().max(100).optional(), // se autogenera si no viene
  description: z
    .string()
    .trim()
    .max(200, "Máximo 200 caracteres")
    .optional(),
  isActive: z.boolean().optional().default(true),
  sortOrder: z.number().int().min(0).optional().default(0),
});

export const CategoryUpdateSchema = z.object({
  name: noHTML.optional(),
  slug: z.string().trim().toLowerCase().max(100).optional(),
  description: z.string().trim().max(200).optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export type CategoryCreateInput = z.infer<typeof CategoryCreateSchema>;
export type CategoryUpdateInput = z.infer<typeof CategoryUpdateSchema>;
