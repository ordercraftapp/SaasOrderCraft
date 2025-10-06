// src/lib/security/zod-schemas.ts
import { z } from 'zod';

/* ---------------------------------------------
 * 1) ESQUEMAS LEGACY (NO MODIFICADOS)
 *    -> Mantengo tus exports tal cual, para no romper uso existente.
 * --------------------------------------------- */

export const AddonSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).max(80),
  extraPriceCents: z.number().int().min(0),
});

export const OrderItemSchema = z.object({
  itemId: z.string().min(1),
  title: z.string().min(1).max(100),
  unitPriceCents: z.number().int().min(0),
  quantity: z.number().int().min(1).max(50),
  notes: z.string().max(300).optional(),
  addons: z.array(AddonSchema).max(20).default([]),
});

/**
 * Legacy: request simple con 'dine_in' o 'delivery' (lo dejamos como está).
 * NOTA: Para el nuevo pickup y extras de delivery, abajo añado una versión V2
 * con union discriminada (no rompe lo anterior).
 */
export const OrderCreateSchema = z.object({
  type: z.enum(['dine_in', 'delivery']),
  tableNumber: z.number().int().min(1).max(500).optional(),
  customerName: z.string().max(100).optional(),
  phone: z.string().max(30).optional(),
  addressLine1: z.string().max(120).optional(),
  addressLine2: z.string().max(120).optional(),
  notes: z.string().max(300).optional(),
  items: z.array(OrderItemSchema).min(1).max(100),
  tipCents: z.number().int().min(0).default(0),
});

/* ---------------------------------------------
 * 2) NUEVO: OrderCreateSchemaV2 con PICKUP y reglas por tipo
 *    -> Mantiene snake_case para no mezclarnos con los tipos del cliente.
 *    -> ÚSALO en endpoints nuevos; el viejo sigue disponible.
 * --------------------------------------------- */

const CreateDineIn = z.object({
  type: z.literal('dine_in'),
  tableNumber: z.number().int().min(1).max(500),
  customerName: z.string().max(100).optional(),
  notes: z.string().max(300).optional(),
  items: z.array(OrderItemSchema).min(1).max(100),
  tipCents: z.number().int().min(0).default(0),
});

const CreateDelivery = z.object({
  type: z.literal('delivery'),
  customerName: z.string().max(100).optional(),
  phone: z.string().min(1).max(30),
  addressLine1: z.string().min(1).max(120),
  addressLine2: z.string().max(120).optional(),
  notes: z.string().max(300).optional(),
  items: z.array(OrderItemSchema).min(1).max(100),
  tipCents: z.number().int().min(0).default(0), // normalmente 0 en delivery
  // NUEVO: opción de envío (IDs del doc de admin + snapshot opcional)
  deliveryOptionId: z.string().min(1).optional(),
  deliveryOptionCents: z.number().int().min(0).optional(),
});

const CreatePickup = z.object({
  type: z.literal('pickup'),
  customerName: z.string().max(100).optional(),
  phone: z.string().min(1).max(30),
  notes: z.string().max(300).optional(),
  items: z.array(OrderItemSchema).min(1).max(100),
  tipCents: z.number().int().min(0).default(0), // aplica propina sugerida si deseas
});

export const OrderCreateSchemaV2 = z.discriminatedUnion('type', [
  CreateDineIn,
  CreateDelivery,
  CreatePickup,
]);

/* ---------------------------------------------
 * 3) NUEVO: Esquemas para opciones de envío (admin/deliveryOptions)
 *    -> Usamos precios en QUETZALES (number), como en tu checkout.
 * --------------------------------------------- */

export const DeliveryOptionSchema = z.object({
  title: z.string().min(1).max(120),
  description: z.string().max(300).optional(),
  price: z.number().min(0),             // GTQ, p.ej. 15.00
  isActive: z.boolean().default(true),
  sortOrder: z.number().int().min(0).default(0),
  createdAt: z.any().optional(),        // Firestore Timestamp
  updatedAt: z.any().optional(),
});

/* ---------------------------------------------
 * 4) NUEVO: Esquemas que reflejan EXACTO el documento de Firestore
 *    que crea tu checkout (GTQ en number).
 *    -> Respeta tu payload actual y SÓLO añade lo nuevo (totals, pickup,
 *       deliveryOption).
 * --------------------------------------------- */

// Líneas del carrito que guarda tu checkout
const CartAddonSchema = z.object({
  name: z.string().min(1),
  price: z.number().min(0), // GTQ
});

const CartGroupItemSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  priceDelta: z.number().min(0), // GTQ
});

const CartOptionGroupSchema = z.object({
  groupId: z.string().min(1),
  groupName: z.string().min(1),
  type: z.enum(['single', 'multi']).optional(),
  items: z.array(CartGroupItemSchema),
});

const CartLineSchema = z.object({
  menuItemId: z.string().min(1),
  menuItemName: z.string().min(1),
  basePrice: z.number().min(0), // GTQ
  quantity: z.number().int().min(1),
  addons: z.array(CartAddonSchema),
  optionGroups: z.array(CartOptionGroupSchema),
  lineTotal: z.number().min(0), // GTQ
});

// orderInfo según el tipo REAL que guardas en Firestore desde el checkout
const DineInInfoSchema = z.object({
  type: z.literal('dine-in'),
  table: z.string().min(1),
  notes: z.string().optional().nullable(),
});

const DeliveryInfoSchema = z.object({
  type: z.literal('delivery'),
  address: z.string().min(1),
  phone: z.string().min(1),
  notes: z.string().optional().nullable(),

  // Campos adicionales que ya manejas para delivery
  delivery: z.enum(['pending', 'inroute', 'delivered']).optional().nullable(),
  customerName: z.string().optional().nullable(),
  addressLabel: z.enum(['home', 'office']).optional().nullable(),
  addressInfo: z
    .object({
      line1: z.string().optional().nullable(),
      city: z.string().optional().nullable(),
      country: z.string().optional().nullable(),
      zip: z.string().optional().nullable(),
      notes: z.string().optional().nullable(),
    })
    .optional()
    .nullable(),
  addressNotes: z.string().optional().nullable(),

  // NUEVO: opción de envío congelada en la orden
  deliveryOptionId: z.string().optional().nullable(),
  deliveryOption: z
    .object({
      title: z.string(),
      description: z.string().optional().nullable(),
      price: z.number().min(0), // GTQ
    })
    .optional()
    .nullable(),
});

const PickupInfoSchema = z.object({
  type: z.literal('pickup'),
  phone: z.string().min(1),
  notes: z.string().optional().nullable(),
});

export const AppOrderInfoSchema = z.discriminatedUnion('type', [
  DineInInfoSchema,
  DeliveryInfoSchema,
  PickupInfoSchema,
]);

// NUEVO: desglose de totales en GTQ (opcional para no romper docs viejos)
export const TotalsSchema = z.object({
  subtotal: z.number().min(0),
  deliveryFee: z.number().min(0),
  tip: z.number().min(0),
  currency: z.string().default('GTQ'),
});

// Documento Firestore final que guardas con addDoc(collection('orders'), payload)
export const FirestoreOrderSchema = z.object({
  items: z.array(CartLineSchema).min(1),
  orderTotal: z.number().min(0), // ← ahora es el GRAN TOTAL (subtotal + delivery + tip)
  orderInfo: AppOrderInfoSchema,

  // NUEVO (no obligatorio en docs antiguos)
  totals: TotalsSchema.optional(),

  status: z.string(),         // p.ej. 'placed'
  createdAt: z.any(),         // Firestore Timestamp

  userEmail: z.string().email().optional().nullable(),
  userEmail_lower: z.string().email().optional().nullable(),
  createdBy: z
    .object({
      uid: z.string().optional().nullable(),
      email: z.string().email().optional().nullable(),
    })
    .optional()
    .nullable(),
});
