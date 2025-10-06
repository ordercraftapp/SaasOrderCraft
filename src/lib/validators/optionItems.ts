// src/lib/validators/optionItems.ts
import { z } from "zod";

const noHTML80 = z.string().trim().min(1).max(80).refine(v => !/[<>]/.test(v), "Caracteres inválidos");
const noHTML200 = z.string().trim().max(200).refine(v => !/[<>]/.test(v), "Caracteres inválidos");

export const OptionItemCreateSchema = z.object({
  groupId: z.string().trim().min(1, "groupId requerido"),
  name: noHTML80,
  slug: z.string().trim().toLowerCase().max(100).optional(),
  description: noHTML200.optional(),
  priceDelta: z.number().min(-100000).max(100000).default(0),
  isDefault: z.boolean().optional().default(false),
  isActive: z.boolean().optional().default(true),
  sortOrder: z.number().int().min(0).optional().default(0),
});

export const OptionItemUpdateSchema = z.object({
  groupId: z.string().trim().min(1).optional(),
  name: noHTML80.optional(),
  slug: z.string().trim().toLowerCase().max(100).optional(),
  description: noHTML200.optional(),
  priceDelta: z.number().min(-100000).max(100000).optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export type OptionItemCreateInput = z.infer<typeof OptionItemCreateSchema>;
export type OptionItemUpdateInput = z.infer<typeof OptionItemUpdateSchema>;
