// src/lib/newcart/contect.tsx
'use client';

import React, { createContext, useContext, useEffect, useMemo, useReducer } from 'react';
import type { NewCartContextValue, NewCartItem, NewCartState } from './types';

const STORAGE_KEY = 'newcart_v1';

const initialState: NewCartState = { items: [] };

type Action =
  | { type: 'ADD'; payload: NewCartItem }
  | { type: 'REMOVE'; payload: { index: number } }
  | { type: 'QTY'; payload: { index: number; quantity: number } }
  | { type: 'CLEAR' }
  | { type: 'HYDRATE'; payload: NewCartState };

function reducer(state: NewCartState, action: Action): NewCartState {
  switch (action.type) {
    case 'HYDRATE':
      return action.payload;
    case 'ADD':
      return { items: [...state.items, action.payload] };
    case 'REMOVE':
      return { items: state.items.filter((_, i) => i !== action.payload.index) };
    case 'QTY':
      return {
        items: state.items.map((it, i) => (i === action.payload.index ? { ...it, quantity: action.payload.quantity } : it)),
      };
    case 'CLEAR':
      return { items: [] };
    default:
      return state;
  }
}

const Ctx = createContext<NewCartContextValue | undefined>(undefined);

function lineExtrasTotal(line: NewCartItem) {
  const addons = (line.addons || []).reduce((acc, a) => acc + Number(a.price || 0), 0);
  const options = (line.optionGroups || []).reduce(
    (acc, g) => acc + g.items.reduce((x, it) => x + Number(it.priceDelta || 0), 0),
    0
  );
  return addons + options;
}

export function NewCartProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  // Hydrate from localStorage
  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed: NewCartState = JSON.parse(raw);
        if (parsed && Array.isArray(parsed.items)) {
          dispatch({ type: 'HYDRATE', payload: parsed });
        }
      }
    } catch {}
  }, []);

  // Persist
  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {}
  }, [state]);

  const value = useMemo<NewCartContextValue>(() => {
    return {
      items: state.items,
      add: (item) => dispatch({ type: 'ADD', payload: item }),
      remove: (index) => dispatch({ type: 'REMOVE', payload: { index } }),
      updateQuantity: (index, quantity) => dispatch({ type: 'QTY', payload: { index, quantity: Math.max(1, quantity) } }),
      clear: () => dispatch({ type: 'CLEAR' }),
      computeLineTotal: (line) => (line.basePrice + lineExtrasTotal(line)) * (line.quantity || 1),
      computeGrandTotal: () => state.items.reduce((acc, ln) => acc + (ln.basePrice + lineExtrasTotal(ln)) * (ln.quantity || 1), 0),
    };
  }, [state]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useNewCart() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useNewCart must be used within NewCartProvider');
  return ctx;
}
