// src/lib/server/orders.ts
import type { OrderStatus } from "@/types/firestore";

export type OrderType = "dine_in" | "takeaway" | "delivery";

const STATUS_ALIASES: Record<string, OrderStatus> = {
  // kitchen
  inprogress: "kitchen_in_progress",
  "kitchen-in-progress": "kitchen_in_progress",
  "kitchen_in_progress": "kitchen_in_progress",

  // ready to close
  ready: "ready_to_close",
  "ready-to-close": "ready_to_close",
  "ready_to_close": "ready_to_close",

  // closed
  completed: "closed",
  complete: "closed",
  done: "closed",
  closed: "closed",
};

export function normalizeStatus(input: string): OrderStatus {
  const key = String(input || "").trim().toLowerCase();
  // estados oficiales primero
  const official: OrderStatus[] = [
    "cart",
    "placed",
    "kitchen_in_progress",
    "kitchen_done",
    "ready_to_close",
    "assigned_to_courier",
    "on_the_way",
    "delivered",
    "ready_to_close", // redundante pero claro
    "closed",
    "cancelled",
  ];
  if ((official as string[]).includes(key)) return key as OrderStatus;

  // alias
  const mapped = STATUS_ALIASES[key];
  if (mapped) return mapped;

  throw new Error(`Unknown status: ${input}`);
}

const FLOW: Record<OrderType, Array<[OrderStatus, OrderStatus]>> = {
  dine_in: [
    ["placed", "kitchen_in_progress"],
    ["kitchen_in_progress", "kitchen_done"],
    ["kitchen_done", "ready_to_close"],
    ["ready_to_close", "closed"], // <- esta es la que necesitas
    // cancelaciones
    ["placed", "cancelled"],
    ["kitchen_in_progress", "cancelled"],
    ["kitchen_done", "cancelled"],
    ["ready_to_close", "cancelled"],
  ],
  takeaway: [
    ["placed", "kitchen_in_progress"],
    ["kitchen_in_progress", "kitchen_done"],
    ["kitchen_done", "ready_to_close"],
    ["ready_to_close", "closed"],
    ["placed", "cancelled"],
    ["kitchen_in_progress", "cancelled"],
    ["kitchen_done", "cancelled"],
    ["ready_to_close", "cancelled"],
  ],
  delivery: [
    ["placed", "kitchen_in_progress"],
    ["kitchen_in_progress", "kitchen_done"],
    ["kitchen_done", "assigned_to_courier"],
    ["assigned_to_courier", "on_the_way"],
    ["on_the_way", "delivered"],
    ["delivered", "closed"],
    ["placed", "cancelled"],
    ["kitchen_in_progress", "cancelled"],
    ["kitchen_done", "cancelled"],
    ["assigned_to_courier", "cancelled"],
    ["on_the_way", "cancelled"],
  ],
};

export function canTransition(
  current: OrderStatus,
  next: OrderStatus,
  type: OrderType
): boolean {
  const rules = FLOW[type] || [];
  return rules.some(([from, to]) => from === current && to === next);
}
