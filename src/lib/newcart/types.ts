// src/lib/newcart/types.ts

export type Addon = { name: string; price: number };
export type OptionGroupItem = { id: string; name: string; priceDelta: number };
export type OptionGroup = {
  groupId: string;
  groupName: string;
  type?: 'single' | 'multi';
  items: OptionGroupItem[];
};

export type NewCartItem = {
  menuItemId: string;
  menuItemName: string;
  basePrice: number;
  quantity: number;
  addons: Addon[];
  optionGroups: OptionGroup[];
  totalPrice?: number; // opcional; recalculamos por seguridad
};

export type DineInInfo = {
  type: 'dine-in';
  table: string;
  notes?: string;
};

export type DeliveryInfo = {
  type: 'delivery';
  address: string;
  phone: string;
  notes?: string;
};

export type OrderMeta = DineInInfo | DeliveryInfo;

export type NewCartState = {
  items: NewCartItem[];
};

export type NewCartContextValue = {
  items: NewCartItem[];
  add: (item: NewCartItem) => void;
  remove: (index: number) => void;
  updateQuantity: (index: number, quantity: number) => void;
  clear: () => void;
  computeLineTotal: (line: NewCartItem) => number;
  computeGrandTotal: () => number;
};
