// src/lib/cart/context.tsx
"use client";

import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  useCallback,
  type ReactNode,
} from "react";

export type CartOptionSel = { groupId: string; optionItemIds: string[] };

export type CartLine = {
  id: string;                 // uuid de línea
  menuItemId: string;
  menuItemName: string;
  quantity: number;
  selections?: CartOptionSel[];
  note?: string;
};

export type CartState = {
  lines: CartLine[];
  tipAmount: number;
  couponCode?: string | null;
  type: "dine_in" | "delivery";
  tableNumber?: string;
  deliveryAddress?: string;
  contactPhone?: string;
  notes?: string;
};

type CartContextValue = {
  cart: CartState;
  add: (ln: Omit<CartLine, "id">) => void;
  remove: (id: string) => void;
  clear: () => void;
  setQuantity: (id: string, qty: number) => void;
  setMeta: (patch: Partial<CartState>) => void;
};

const LS_KEY = "cart:v1";

// 👉 Usamos `undefined` como valor inicial para evitar conflictos de tipos
const CartCtx = createContext<CartContextValue | undefined>(undefined);

function uuid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [cart, setCart] = useState<CartState>({
    lines: [],
    tipAmount: 0,
    type: "dine_in",
  });

  // hydrate de LS
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.lines)) {
          setCart(parsed as CartState);
        }
      }
    } catch {
      // ignore
    }
  }, []);

  // persist
  useEffect(() => {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(cart));
    } catch {
      // ignore
    }
  }, [cart]);

  const add = useCallback((ln: Omit<CartLine, "id">) => {
    setCart((c) => ({ ...c, lines: [...c.lines, { ...ln, id: uuid() }] }));
  }, []);

  const remove = useCallback((id: string) => {
    setCart((c) => ({ ...c, lines: c.lines.filter((l) => l.id !== id) }));
  }, []);

  const clear = useCallback(() => {
    setCart({ lines: [], tipAmount: 0, type: "dine_in" });
  }, []);

  const setQuantity = useCallback((id: string, qty: number) => {
    const q = Number.isFinite(qty) && qty > 0 ? Math.floor(qty) : 1;
    setCart((c) => ({
      ...c,
      lines: c.lines.map((l) => (l.id === id ? { ...l, quantity: q } : l)),
    }));
  }, []);

  const setMeta = useCallback((patch: Partial<CartState>) => {
    setCart((c) => ({ ...c, ...patch }));
  }, []);

  const api = useMemo<CartContextValue>(
    () => ({ cart, add, remove, clear, setQuantity, setMeta }),
    [cart, add, remove, clear, setQuantity, setMeta]
  );

  // ✅ El tipo de `value` coincide exactamente con `CartContextValue | undefined`
  return <CartCtx.Provider value={api}>{children}</CartCtx.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartCtx);
  if (ctx === undefined) {
    throw new Error("useCart must be used within CartProvider");
  }
  return ctx;
}

// Helper para /api/cart/quote y /api/orders
export function buildQuotePayload(cart: CartState) {
  return {
    items: cart.lines.map((l) => ({
      menuItemId: l.menuItemId,
      quantity: l.quantity,
      ...(l.selections?.length ? { options: l.selections } : {}),
    })),
    tipAmount: cart.tipAmount || 0,
    couponCode: cart.couponCode || undefined,
  };
}
