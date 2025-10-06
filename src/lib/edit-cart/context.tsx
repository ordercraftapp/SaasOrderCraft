"use client";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type EditCartLine = {
  menuItemId: string;
  name?: string;
  quantity: number;
  unitPriceCents?: number;
  selections?: Array<{ groupId: string; optionItemIds: string[] }>;
};

export type EditCartState = {
  orderId: string | null;   // SIEMPRE anclado a la orden que editamos
  lines: EditCartLine[];
  currency?: string;
  type?: "dine_in" | "delivery" | "pickup";
  tableNumber?: string;
  notes?: string;
  tipCents?: number;
};

type Ctx = {
  cart: EditCartState;
  setCart: React.Dispatch<React.SetStateAction<EditCartState>>;
  clear: () => void; // limpia líneas pero mantiene orderId (útil entre pantallas)
  resetAll: () => void; // limpia TODO (incluye orderId)
  loadFromOrderDoc: (order: any, orderId: string) => void;
  addLine: (line: EditCartLine) => void;
  removeLine: (menuItemId: string) => void;
  updateQuantity: (menuItemId: string, qty: number) => void;
};

const LS_KEY = "editcart:v1";
const defaultState: EditCartState = {
  orderId: null,
  lines: [],
  currency: "GTQ",
  type: "dine_in",
  tableNumber: "",
  notes: "",
  tipCents: 0,
};

const EditCartCtx = createContext<Ctx | null>(null);

export function EditCartProvider({ children }: { children: React.ReactNode }) {
  const [cart, setCart] = useState<EditCartState>(() => {
    try {
      const raw = localStorage.getItem(LS_KEY);
      return raw ? { ...defaultState, ...JSON.parse(raw) } : defaultState;
    } catch {
      return defaultState;
    }
  });

  useEffect(() => {
    localStorage.setItem(LS_KEY, JSON.stringify(cart));
  }, [cart]);

  const clear = useCallback(() => {
    setCart(c => ({ ...c, lines: [] }));
  }, []);

  const resetAll = useCallback(() => {
    setCart(defaultState);
  }, []);

  const loadFromOrderDoc = useCallback((order: any, orderId: string) => {
    // Acepta modelo OPS (order.items/order.amounts) y/o legacy (order.lines/order.totals)
    let lines: EditCartLine[] = [];
    if (Array.isArray(order?.items) && order.items.length) {
      lines = order.items.map((it: any) => ({
        menuItemId: it.menuItemId,
        name: it.name,
        quantity: it.quantity ?? 1,
        unitPriceCents: it.unitPriceCents,
        selections: Array.isArray(it.options)
          ? it.options.map((og: any) => ({
              groupId: og.groupId,
              optionItemIds: og.optionItemIds ?? [],
            }))
          : [],
      }));
    } else if (Array.isArray(order?.lines)) {
      lines = order.lines.map((ln: any) => ({
        menuItemId: ln.menuItemId,
        name: ln.name,
        quantity: ln.qty ?? ln.quantity ?? 1,
        unitPriceCents: ln.unitPriceCents ?? ln.priceCents,
        selections: Array.isArray(ln.selections)
          ? ln.selections.map((og: any) => ({
              groupId: og.groupId,
              optionItemIds: og.optionItemIds ?? [],
            }))
          : [],
      }));
    }

    setCart({
      orderId,
      lines,
      currency: order?.currency ?? "GTQ",
      type: order?.type ?? "dine_in",
      tableNumber: order?.tableNumber ?? "",
      notes: order?.notes ?? "",
      tipCents: order?.amounts?.tipCents ?? 0,
    });
  }, []);

  const addLine = useCallback((line: EditCartLine) => {
    setCart(c => {
      const idx = c.lines.findIndex(l => l.menuItemId === line.menuItemId);
      if (idx >= 0) {
        const next = [...c.lines];
        next[idx] = { ...next[idx], quantity: (next[idx].quantity ?? 1) + (line.quantity ?? 1) };
        return { ...c, lines: next };
    }
      return { ...c, lines: [...c.lines, line] };
    });
  }, []);

  const removeLine = useCallback((menuItemId: string) => {
    setCart(c => ({ ...c, lines: c.lines.filter(l => l.menuItemId !== menuItemId) }));
  }, []);

  const updateQuantity = useCallback((menuItemId: string, qty: number) => {
    setCart(c => ({
      ...c,
      lines: c.lines.map(l => (l.menuItemId === menuItemId ? { ...l, quantity: qty } : l)),
    }));
  }, []);

  const value = useMemo(
    () => ({ cart, setCart, clear, resetAll, loadFromOrderDoc, addLine, removeLine, updateQuantity }),
    [cart, clear, resetAll, loadFromOrderDoc, addLine, removeLine, updateQuantity]
  );

  return <EditCartCtx.Provider value={value}>{children}</EditCartCtx.Provider>;
}

export const useEditCart = () => {
  const ctx = useContext(EditCartCtx);
  if (!ctx) throw new Error("useEditCart must be used within EditCartProvider");
  return ctx;
};
