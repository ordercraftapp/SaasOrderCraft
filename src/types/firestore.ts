// src/types/firestore.ts

export type TimestampISO = string; // lo cambiaremos por Firestore Timestamp donde aplique

export type OrderStatus =
  | 'cart'
  | 'placed'
  | 'kitchen_in_progress'
  | 'kitchen_done'
  | 'ready_to_close'
  | 'assigned_to_courier'
  | 'on_the_way'
  | 'delivered'
  | 'closed'
  | 'cancelled';

export interface Category {
  id: string;
  name: string;
  slug: string;
  description?: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: TimestampISO;
  updatedAt: TimestampISO;
}

export interface Subcategory {
  id: string;
  categoryId: string;
  name: string;
  slug: string;
  description?: string;
  isActive: boolean;
  sortOrder: number;
  createdAt: TimestampISO;
  updatedAt: TimestampISO;
}

export interface MenuItem {
  id: string;
  subcategoryId: string;
  title: string;
  slug: string;
  imageUrl?: string;
  ingredients: string[];
  description?: string;
  basePriceCents: number;
  allowNotes: boolean;
  isActive: boolean;
  sortOrder: number;
  createdAt: TimestampISO;
  updatedAt: TimestampISO;
}

export interface Addon {
  id: string;
  itemId: string;
  name: string;
  extraPriceCents: number;
  isActive: boolean;
  createdAt: TimestampISO;
  updatedAt: TimestampISO;
}

export type OrderType = 'dine_in' | 'delivery';

export interface OrderItem {
  id: string;
  itemId: string;
  title: string;
  unitPriceCents: number;
  quantity: number;
  notes?: string;
  addons: Array<{
    id: string;
    name: string;
    extraPriceCents: number;
  }>;
  createdAt: TimestampISO;
}

export interface Order {
  id: string;
  type: OrderType;
  tableNumber?: number;
  customerName?: string;
  phone?: string;
  addressLine1?: string;
  addressLine2?: string;
  createdBy: string; // uid
  status: OrderStatus;
  subtotalCents: number;
  tipCents: number;
  totalCents: number;
  paymentMethod?: string;
  paymentStatus?: string;
  paymentProvider?: string;
  providerRefId?: string;
  notes?: string;
  createdAt: TimestampISO;
  updatedAt: TimestampISO;
}
