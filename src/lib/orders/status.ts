// src/lib/orders/status.ts

// Estados reconocidos en tu flujo
export const ORDER_STATUSES = [
  "cart",
  "placed",
  "kitchen_in_progress",
  "kitchen_done",
  "ready_to_close",
  "assigned_to_courier",
  "on_the_way",
  "delivered",
  "closed",
  "cancelled",
] as const;

export type OrderStatus = typeof ORDER_STATUSES[number];

// Agrupaciones para filtros rápidos en pantallas de admin
export const ACTIVE_STATUSES: OrderStatus[] = [
  "placed",
  "kitchen_in_progress",
  "kitchen_done",
  "ready_to_close",
  "assigned_to_courier",
  "on_the_way",
  "delivered",
];

export function isClosed(status?: string | null) {
  return status === "closed";
}

export function isCancelled(status?: string | null) {
  return status === "cancelled";
}

export function isActive(status?: string | null) {
  if (!status) return false;
  return ACTIVE_STATUSES.includes(status as OrderStatus);
}

// Etiquetas amigables para mostrar en UI
export function statusLabel(s?: string) {
  const map: Record<string, string> = {
    cart: "Carrito",
    placed: "Creada",
    kitchen_in_progress: "En cocina",
    kitchen_done: "Lista (cocina)",
    ready_to_close: "Lista para caja",
    assigned_to_courier: "Asignada a repartidor",
    on_the_way: "En camino",
    delivered: "Entregada",
    closed: "Cerrada",
    cancelled: "Cancelada",
  };
  return map[s || ""] || s || "—";
}
