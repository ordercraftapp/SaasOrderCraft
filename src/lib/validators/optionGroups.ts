// src/lib/validators/optionGroups.ts
import { z } from "zod";

const noHTML80 = z.string().trim().min(1).max(80).refine(v => !/[<>]/.test(v), "Caracteres inválidos");
const noHTML200 = z.string().trim().max(200).refine(v => !/[<>]/.test(v), "Caracteres inválidos");

export const OptionGroupCreateSchema = z.object({
  menuItemId: z.string().trim().min(1, "menuItemId requerido"),
  name: noHTML80,
  slug: z.string().trim().toLowerCase().max(100).optional(),
  description: noHTML200.optional(),
  minSelect: z.number().int().min(0).max(10).default(0),
  maxSelect: z.number().int().min(0).max(10).default(1),
  required: z.boolean().optional(), // redundante si minSelect>=1, pero útil para UI
  isActive: z.boolean().optional().default(true),
  sortOrder: z.number().int().min(0).optional().default(0),
});

export const OptionGroupUpdateSchema = z.object({
  menuItemId: z.string().trim().min(1).optional(),
  name: noHTML80.optional(),
  slug: z.string().trim().toLowerCase().max(100).optional(),
  description: noHTML200.optional(),
  minSelect: z.number().int().min(0).max(10).optional(),
  maxSelect: z.number().int().min(0).max(10).optional(),
  required: z.boolean().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
}).refine((data) => {
  if (data.minSelect !== undefined && data.maxSelect !== undefined) {
    return data.minSelect <= data.maxSelect;
  }
  return true;
}, { message: "minSelect no puede ser mayor que maxSelect" });

export type OptionGroupCreateInput = z.infer<typeof OptionGroupCreateSchema>;
export type OptionGroupUpdateInput = z.infer<typeof OptionGroupUpdateSchema>;
