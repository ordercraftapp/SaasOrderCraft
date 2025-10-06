// src/lib/validators/cart.ts
import { z } from "zod";

export const CartItemOptionSelectionSchema = z.object({
  groupId: z.string().trim().min(1),
  optionItemIds: z.array(z.string().trim().min(1)).max(20).default([]),
});

export const CartItemSchema = z.object({
  menuItemId: z.string().trim().min(1),
  quantity: z.number().int().min(1).max(99).default(1),
  options: z.array(CartItemOptionSelectionSchema).default([]),
});

export const PricingQuoteSchema = z.object({
  items: z.array(CartItemSchema).min(1).max(100),
  tipAmount: z.number().min(0).optional().default(0),      // el cliente sugiere; el server valida
  couponCode: z.string().trim().max(40).optional(),         // server valida en Firestore
});

export type PricingQuoteInput = z.infer<typeof PricingQuoteSchema>;
export type CartItemInput = z.infer<typeof CartItemSchema>;
