// src/lib/tables/useAvailableTables.ts
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getFirestore,
  doc,
  getDoc,
  collection,
  onSnapshot,
  query,
  where,
  Timestamp,
} from "firebase/firestore";

type FirestoreTS = Timestamp | { seconds: number; nanoseconds?: number } | Date | null | undefined;

type OrderDoc = {
  id: string;
  createdAt?: FirestoreTS;
  updatedAt?: FirestoreTS;
  orderInfo?: { type?: "dine-in" | "delivery" | "pickup"; table?: string | number | null };
  status?: "placed" | "kitchen_in_progress" | "kitchen_done" | "ready_to_close" | "closed";
};

const OPEN_STATUSES: NonNullable<OrderDoc["status"]>[] = [
  "placed",
  "kitchen_in_progress",
  "kitchen_done",
  "ready_to_close",
];

function tsToDate(ts: FirestoreTS): Date | null {
  if (!ts) return null;
  if (ts instanceof Date) return ts;
  if (typeof (ts as any)?.seconds === "number") {
    return new Date(((ts as any).seconds as number) * 1000);
  }
  if (ts instanceof Timestamp) return ts.toDate();
  return null;
}

function updatedOrCreatedAt(d?: OrderDoc) {
  return tsToDate(d?.updatedAt) || tsToDate(d?.createdAt) || new Date(0);
}

export function useAvailableTables() {
  const db = useMemo(() => getFirestore(), []);
  const [numTables, setNumTables] = useState<number>(12);
  const [occupied, setOccupied] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const snap = await getDoc(doc(db, "settings", "waiter"));
        if (snap.exists()) {
          const n = Number((snap.data() as any)?.numTables ?? 12);
          if (mounted) setNumTables(Math.min(200, Math.max(1, Number.isFinite(n) ? n : 12)));
        }
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => {
      mounted = false;
    };
  }, [db]);

  useEffect(() => {
    // Escucha todas las órdenes abiertas de tipo dine-in y mapea mesas ocupadas
    const qRef = query(
      collection(db, "orders"),
      where("orderInfo.type", "==", "dine-in"),
      where("status", "in", OPEN_STATUSES)
      // sin orderBy: no es necesario para obtener ocupación
    );

    const unsub = onSnapshot(qRef, (snap) => {
      // Por mesa, nos quedamos con la orden más “reciente”
      const latestByTable = new Map<string, OrderDoc>();
      for (const d of snap.docs) {
        const data = { id: d.id, ...(d.data() as any) } as OrderDoc;
        const tRaw = data?.orderInfo?.table;
        if (tRaw == null) continue;
        const t = String(tRaw);
        const prev = latestByTable.get(t);
        if (!prev) {
          latestByTable.set(t, data);
        } else {
          const prevT = updatedOrCreatedAt(prev)!;
          const curT = updatedOrCreatedAt(data)!;
          if (curT >= prevT) latestByTable.set(t, data);
        }
      }
      setOccupied(Array.from(latestByTable.keys()));
    });

    return () => unsub();
  }, [db]);

  const allTables = useMemo(
    () => Array.from({ length: numTables }, (_, i) => String(i + 1)),
    [numTables]
  );

  const available = useMemo(() => {
    const occ = new Set(occupied.map(String));
    return allTables.filter((t) => !occ.has(t));
  }, [allTables, occupied]);

  return { loading, numTables, occupied, available, allTables };
}
