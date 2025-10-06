// src/lib/money.ts
"use client";
import { useFmtCurrency } from "@/lib/settings/hooks";

/**
 * Hook wrapper to keep old naming: fmtQ(...)
 * Uso:
 *   const fmtQ = useFmtQ();
 *   <span>{fmtQ(123.45)}</span>
 */
export function useFmtQ() {
  return useFmtCurrency();
}
