// src/lib/validators/orders.ts
import { z } from 'zod';

/** ──────────────────────────────────────────────────────────────────────────
 *  Tipo de pedido (se mantiene igual)
 *  ────────────────────────────────────────────────────────────────────────── */
export const OrderTypeSchema = z.enum(['dine_in', 'delivery']);

/**
 * ⚠️ (Legacy) Schemas de ítems y creación usados en una versión previa del POST /orders.
 * Tu implementación actual calcula precios en el servidor con PricingQuoteSchema,
 * pero dejamos esto para compatibilidad con cualquier import existente.
 */
export const OrderItemAddonSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  extraPriceCents: z.number().int().nonnegative(),
});

export const OrderItemSchema = z.object({
  id: z.string().min(1),            // id interno de la línea (uuid en cliente)
  itemId: z.string().min(1),        // referencia al MenuItem
  title: z.string().min(1),
  unitPriceCents: z.number().int().nonnegative(),
  quantity: z.number().int().positive(),
  notes: z.string().optional(),
  addons: z.array(OrderItemAddonSchema).default([]),
  createdAt: z.string().min(1),     // ISO string
});

/** (Legacy) Mantener por compat: el POST actual usa PricingQuoteSchema en lib/validators/cart */
export const CreateOrderSchema = z.object({
  type: OrderTypeSchema,
  tableNumber: z.number().int().positive().optional(),
  customerName: z.string().optional(),
  phone: z.string().optional(),
  addressLine1: z.string().optional(),
  addressLine2: z.string().optional(),
  items: z.array(OrderItemSchema).min(1),

  subtotalCents: z.number().int().nonnegative(),
  tipCents: z.number().int().nonnegative(),
  totalCents: z.number().int().nonnegative(),

  paymentMethod: z.string().optional(),
  paymentStatus: z.string().optional(),
  paymentProvider: z.string().optional(),
  providerRefId: z.string().optional(),
  notes: z.string().optional(),
});

/** ──────────────────────────────────────────────────────────────────────────
 *  Estados oficiales (snake_case) usados actualmente en UI y backend
 *  ────────────────────────────────────────────────────────────────────────── */
export const OrderStatusEnum = z.enum([
  'cart',
  'placed',
  'kitchen_in_progress',
  'kitchen_done',
  'ready_to_close',
  'assigned_to_courier',
  'on_the_way',
  'delivered',
  'closed',
  'cancelled',
]);
export type OrderStatus = z.infer<typeof OrderStatusEnum>;

/** Aliases legacy → actuales (para compat con versiones anteriores) */
const STATUS_ALIASES: Record<string, OrderStatus> = {
  // camelCase → snake_case
  kitchenInProgress: 'kitchen_in_progress',
  kitchenDone: 'kitchen_done',
  readyToClose: 'ready_to_close',
  assignedToCourier: 'assigned_to_courier',
  onTheWay: 'on_the_way',

  // aliases de un set camelCase previo (backoffice antiguo)
  ready: 'ready_to_close',            // antes "ready"
  served: 'delivered',                // aproximación: served ≈ delivered
  completed: 'closed',                // completed ≈ closed
  readyForDelivery: 'assigned_to_courier',
  outForDelivery: 'on_the_way',
};

/** camelCase → snake_case */
function camelToSnake(input: string) {
  return input.replace(/[A-Z]/g, (m) => `_${m.toLowerCase()}`);
}

/** Normaliza cualquier variante a un estado oficial snake_case del enum */
export function normalizeStatusName(s: string): OrderStatus {
  if (!s || typeof s !== 'string') throw new Error('Invalid status');
  const raw = String(s).trim();

  // 1) Coincidencia directa (snake_case ya válido)
  if (OrderStatusEnum.options.includes(raw as OrderStatus)) {
    return raw as OrderStatus;
  }

  // 2) Alias conocidos (camelCase previos o equivalencias)
  const alias = STATUS_ALIASES[raw as keyof typeof STATUS_ALIASES];
  if (alias) return alias;

  // 3) Intento camelCase → snake_case y revalido
  const snake = camelToSnake(raw);
  if (OrderStatusEnum.options.includes(snake as OrderStatus)) {
    return snake as OrderStatus;
  }

  throw new Error(`Unknown status: ${s}`);
}

/** ──────────────────────────────────────────────────────────────────────────
 *  PATCH /api/orders/[id]/status — cuerpo con nextStatus (recomendado)
 *  Acepta { nextStatus } y opcionalmente { reason }.
 *  Compat: si el cliente viejo manda { status }, lo convertimos a { nextStatus }.
 *  ────────────────────────────────────────────────────────────────────────── */
export const UpdateOrderStatusSchema = z.object({
  nextStatus: z
    .string()
    .transform((val) => normalizeStatusName(val))
    .pipe(OrderStatusEnum),
  reason: z.string().trim().max(200).optional(),
});
export type UpdateOrderStatusInput = z.infer<typeof UpdateOrderStatusSchema>;

/**
 * Helper para consumir el body del request y soportar legacy:
 * - Preferimos { nextStatus }
 * - Si viene { status }, lo mapeamos a { nextStatus }
 */
export function parseUpdateOrderStatus(body: unknown): UpdateOrderStatusInput {
  const b = (body ?? {}) as any;
  const candidate = b.nextStatus ?? b.status; // compat
  return UpdateOrderStatusSchema.parse({
    nextStatus: candidate,
    reason: b.reason,
  });
}
