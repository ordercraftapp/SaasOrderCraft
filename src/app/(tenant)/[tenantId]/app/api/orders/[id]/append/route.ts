// src/app/(tenant)/[tenant]/app/api/orders/[id]/append/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";

import { getAdminDB, adminAuth } from "@/lib/firebase/admin";
import { resolveTenantFromRequest, requireTenantId } from "@/lib/tenant/server";

type OptionItem = {
  id?: string;
  name?: string;
  price?: number;
  priceCents?: number;
  priceDelta?: number;
  priceDeltaCents?: number;
  priceExtra?: number;
  priceExtraCents?: number;
};
type NewLine = {
  menuItemId?: string;
  menuItemName?: string;
  basePrice?: number;
  quantity?: number;
  addons?: Array<string | { name?: string; price?: number; priceCents?: number }>;
  optionGroups?: Array<{ groupId?: string; groupName?: string; type?: "single" | "multiple"; items: OptionItem[] }>;
  lineTotal?: number;
  // Meta sellada por servidor:
  addedAt?: any;
  addedBy?: string;
  addedBatchId?: string;
};

const toNum = (x: any) => (Number.isFinite(Number(x)) ? Number(x) : undefined);
const centsToQ = (c?: number) => (Number.isFinite(c) ? Number(c) / 100 : 0);

function extractDeltaQ(x: any): number {
  const a = toNum(x?.priceDelta); if (a !== undefined) return a;
  const b = toNum(x?.priceExtra); if (b !== undefined) return b;
  const ac = toNum(x?.priceDeltaCents); if (ac !== undefined) return ac / 100;
  const bc = toNum(x?.priceExtraCents); if (bc !== undefined) return bc / 100;
  const p = toNum(x?.price); if (p !== undefined) return p;
  const pc = toNum(x?.priceCents); if (pc !== undefined) return pc / 100;
  return 0;
}
function perUnitAddonsQ(l: NewLine): number {
  let sum = 0;
  if (Array.isArray(l.optionGroups)) {
    for (const g of l.optionGroups) for (const it of (g.items || [])) sum += extractDeltaQ(it);
  }
  const addons = l.addons || [];
  for (const it of addons) {
    if (typeof it === "string") continue;
    const p = toNum(it?.price) ?? (toNum(it?.priceCents) !== undefined ? Number(it!.priceCents) / 100 : undefined);
    sum += p ?? 0;
  }
  return sum;
}
function computeLineTotalIfMissing(l: NewLine): number {
  if (toNum(l.lineTotal) !== undefined) return Number(l.lineTotal);
  const qty = Number(l.quantity ?? 1) || 1;
  const base = toNum(l.basePrice) ?? 0;
  const addons = perUnitAddonsQ(l);
  return (base + addons) * qty;
}

// 📁 carpeta es [tenant] → params.tenant
type Ctx = { params: { tenant: string; id: string } };

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const tenantId = requireTenantId(
      resolveTenantFromRequest(req, ctx.params),
      "api:orders/[id]/append:POST"
    );

    const db = getAdminDB();
    const orderId = ctx.params.id;
    if (!orderId) return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });

    // Validación opcional de token (no bloquea si no viene)
    let uid: string | undefined;
    try {
      const authz = req.headers.get("authorization") || "";
      const m = authz.match(/^Bearer\s+(.+)$/i);
      if (m) {
        const token = m[1];
        const decoded = await adminAuth.verifyIdToken(token);
        uid = decoded.uid;
      }
    } catch { /* best-effort */ }

    const body = await req.json().catch(() => null);
    if (!body || !Array.isArray(body.items) || !body.items.length) {
      return NextResponse.json({ ok: false, error: "Body.items vacío" }, { status: 400 });
    }

    const docRef = db.collection(`tenants/${tenantId}/orders`).doc(orderId);
    const batchId = globalThis.crypto?.randomUUID?.() ? globalThis.crypto.randomUUID() : `batch_${Date.now()}`;
    const nowTs = Timestamp.now();

    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(docRef);
      if (!snap.exists) throw new Error("Orden no existe");

      const data = snap.data() || {};
      const prevItems: NewLine[] = Array.isArray(data.items) ? data.items : [];
      const prevCount = prevItems.length;
      const prevTotal =
        toNum(data.orderTotal) ??
        (toNum(data.totals?.totalCents) !== undefined ? centsToQ(data.totals.totalCents) : 0);

      const append: NewLine[] = body.items.map((l: NewLine) => ({
        ...l,
        addedAt: nowTs,      // Timestamp literal en array
        addedBy: uid ?? l.addedBy,
        addedBatchId: batchId,
      }));

      const appendTotal = append.reduce((acc, l) => acc + computeLineTotalIfMissing(l), 0);
      const nextTotal = (prevTotal || 0) + appendTotal;
      const nextItems = [...prevItems, ...append];

      const updateData: Record<string, any> = {
        tenantId,                     // ✅ siempre persistir tenantId
        items: nextItems,
        orderTotal: nextTotal,
        status: "placed",             // vuelve a cocina
        reopenedAt: nowTs,
        currentAppendBatchId: batchId,
        itemsCountBeforeAppend: prevCount,
        updatedAt: nowTs,
      };

      if (data?.totals?.totalCents !== undefined) {
        const prevC = Number(data.totals.totalCents) || 0;
        const appendC = Math.round(appendTotal * 100);
        updateData["totals"] = { ...(data.totals || {}), totalCents: prevC + appendC };
      }

      tx.update(docRef, updateData);
      return { appendCount: append.length, appendTotal, nextTotal, batchId, prevCount };
    });

    return NextResponse.json({ ok: true, tenantId, id: orderId, ...result });
  } catch (e: any) {
    console.error("[append items] error", e);
    return NextResponse.json({ ok: false, error: e?.message || "Error" }, { status: 500 });
  }
}
