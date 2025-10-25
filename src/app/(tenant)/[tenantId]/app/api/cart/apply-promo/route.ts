// src/app/(tenant)/[tenantId]/app/api/cart/apply-promo/route.ts
import { NextRequest, NextResponse } from "next/server";
import * as admin from "firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

// ---------------------------------------------------------------------------
// Bootstrap Admin
// ---------------------------------------------------------------------------
function ensureAdmin() {
  if (!admin.apps.length) {
    const json = process.env.FIREBASE_SERVICE_ACCOUNT_KEY_JSON;
    admin.initializeApp(
      json
        ? { credential: admin.credential.cert(JSON.parse(json)) }
        : { credential: admin.credential.applicationDefault() }
    );
  }
  return admin.app();
}

// Normaliza posibles valores de tipo de orden (alineado a UI)
function normalizeOrderType(t: any): "dine_in" | "delivery" | "takeaway" | undefined {
  const s = String(t || "").toLowerCase().trim();
  if (["dine-in", "dine_in", "dinein", "mesa", "restaurant"].includes(s)) return "dine_in";
  if (["delivery", "envio", "entrega"].includes(s)) return "delivery";
  if (["pickup", "takeaway", "para_llevar", "para-llevar"].includes(s)) return "takeaway";
  return undefined;
}

// Helpers centavos
const toCentsFromAmount = (q: number | string | undefined): number => {
  const n = Number(q);
  return Number.isFinite(n) ? Math.max(0, Math.round(n * 100)) : 0;
};
const toCents = (v?: any): number => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
};

// Proporcional
function splitProportional(totalCents: number, weights: number[]) {
  const sum = weights.reduce((a, b) => a + b, 0);
  if (totalCents <= 0 || sum <= 0) return weights.map(() => 0);
  const raw = weights.map((w) => (w / sum) * totalCents);
  const floors = raw.map((x) => Math.floor(x));
  let remainder = totalCents - floors.reduce((a, b) => a + b, 0);
  const residuals = raw.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < residuals.length && remainder > 0; k++) { floors[residuals[k].i] += 1; remainder--; }
  return floors;
}

// Subtotal de línea (legacy)
function getLineSubtotalCents(line: any): number {
  if (Number.isFinite(line?.lineSubtotalCents)) return toCents(line.lineSubtotalCents);
  if (Number.isFinite(line?.lineTotalCents)) return toCents(line.lineTotalCents);
  if (Number.isFinite(line?.totalPriceCents)) return toCents(line.totalPriceCents);
  const qty = Number.isFinite(line?.quantity) ? Math.max(1, Math.floor(line.quantity)) : 1;
  if (Number.isFinite(line?.unitPriceCents)) return toCents(line.unitPriceCents) * qty;
  if (Number.isFinite(line?.totalPrice)) return toCentsFromAmount(line.totalPrice);
  if (Number.isFinite(line?.unitPrice)) return toCentsFromAmount(line.unitPrice) * qty;
  return 0;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { tenantId: string } }
) {
  try {
    const tenantId = (params?.tenantId || "").trim();
    if (!tenantId) {
      return NextResponse.json({ ok: false, reason: "Missing tenantId" }, { status: 400 });
    }

    ensureAdmin();
    const db = admin.firestore();

    const body = await req.json();

    const codeRaw: string = (body?.code ?? "").toString();
    const code = codeRaw.trim().toUpperCase().replace(/\s+/g, "");
    if (!code) {
      return NextResponse.json({ ok: false, reason: "Código requerido" }, { status: 400 });
    }

    const orderType = normalizeOrderType(body?.orderType);
    if (!orderType) {
      return NextResponse.json({ ok: false, reason: "Tipo de orden inválido" }, { status: 400 });
    }

    const userUid: string | undefined = body?.userUid || undefined;

    // -----------------------------------------------------------------------
    // Cargar promoción por code (ACTIVA) — TENANT-SCOPED
    // -----------------------------------------------------------------------
    const q = await db
      .collection(`tenants/${tenantId}/promotions`)
      .where("code", "==", code)
      .limit(1)
      .get();

    if (q.empty) {
      return NextResponse.json({ ok: false, reason: "Código inválido o inexistente" }, { status: 404 });
    }

    const promoDoc = q.docs[0];
    const promo = { id: promoDoc.id, ...(promoDoc.data() as any) };

    if (promo.active === false) {
      return NextResponse.json({ ok: false, reason: "La promoción no está activa" }, { status: 400 });
    }

    // Vigencia
    const now = new Date();
    const startAt: Date | undefined = promo.startAt?.toDate?.() || (promo.startAt ? new Date(promo.startAt) : undefined);
    const endAt: Date | undefined = promo.endAt?.toDate?.() || (promo.endAt ? new Date(promo.endAt) : undefined);

    if (startAt && now < startAt) return NextResponse.json({ ok: false, reason: "La promoción aún no inicia" }, { status: 400 });
    if (endAt && now > endAt)   return NextResponse.json({ ok: false, reason: "La promoción expiró" }, { status: 400 });

    // Tipos de orden permitidos
    const allowed: string[] | undefined = promo?.constraints?.allowedOrderTypes;
    if (Array.isArray(allowed) && allowed.length > 0) {
      const allowedNorm = allowed.map((t: string) => normalizeOrderType(t)).filter(Boolean) as string[];
      if (!allowedNorm.includes(orderType)) {
        return NextResponse.json({ ok: false, reason: "Este código no aplica a este tipo de orden" }, { status: 400 });
      }
    }

    const globalLimit = Number(promo?.constraints?.globalLimit);
    const perUserLimit = Number(promo?.constraints?.perUserLimit);

    // -----------------------------------------------------------------------
    // Base (subtotal) o legacy por líneas
    // -----------------------------------------------------------------------
    const subtotalCentsFromBody = Number.isFinite(body?.subtotalCents)
      ? toCents(body.subtotalCents)
      : Number.isFinite(body?.subtotal)
      ? toCentsFromAmount(body.subtotal)
      : 0;

    let baseCents = subtotalCentsFromBody;
    let discountByLine: Array<{
      lineId: string;
      menuItemId: string;
      discountCents: number;
      eligible: boolean;
      lineSubtotalCents: number;
    }> = [];

    if (baseCents <= 0) {
      const lines: any[] = Array.isArray(body?.lines) ? body.lines : [];
      if (!lines.length) {
        return NextResponse.json({ ok: false, reason: "Carrito vacío o subtotal no enviado" }, { status: 400 });
      }

      // TENANT-SCOPED lookups (si faltan categoryId/subcategoryId)
      const needLookupIdx: number[] = [];
      const byMenuId: Record<string, any> = {};

      lines.forEach((ln, idx) => {
        if (!ln?.menuItemId) return;
        const hasCat = typeof ln.categoryId === "string" && ln.categoryId;
        const hasSub = typeof ln.subcategoryId === "string" && ln.subcategoryId;
        if (!hasCat || !hasSub) needLookupIdx.push(idx);
      });

      if (needLookupIdx.length > 0) {
        const missingIds = Array.from(new Set(needLookupIdx.map((i) => lines[i].menuItemId)));
        const shots = await Promise.all(
          missingIds.map((id) => db.doc(`tenants/${tenantId}/menuItems/${id}`).get())
        );
        shots.forEach((snap) => {
          if (snap.exists) byMenuId[snap.id] = snap.data();
        });
        for (const i of needLookupIdx) {
          const ln = lines[i];
          const d = byMenuId[ln.menuItemId] || {};
          if (!ln.categoryId && d.categoryId) ln.categoryId = d.categoryId;
          if (!ln.subcategoryId && d.subcategoryId) ln.subcategoryId = d.subcategoryId;
        }
      }

      // Alcance
      const scope = promo?.scope || {};
      const cats: string[] = Array.isArray(scope.categories) ? scope.categories : [];
      const subs: string[] = Array.isArray(scope.subcategories) ? scope.subcategories : [];
      const mis : string[] = Array.isArray(scope.menuItems) ? scope.menuItems : [];
      const isGlobal = cats.length === 0 && subs.length === 0 && mis.length === 0;

      const eligibleFlags: boolean[] = lines.map((ln) => {
        if (isGlobal) return true;
        if (ln?.menuItemId && mis.includes(ln.menuItemId)) return true;
        if (ln?.subcategoryId && subs.includes(ln.subcategoryId)) return true;
        if (ln?.categoryId && cats.includes(ln.categoryId)) return true;
        return false;
      });

      const subtotals = lines.map((ln) => getLineSubtotalCents(ln));
      const targetSub = subtotals.reduce((acc, cents, i) => acc + (eligibleFlags[i] ? cents : 0), 0);
      if (targetSub <= 0) {
        return NextResponse.json({ ok: false, reason: "No hay ítems elegibles para este código" }, { status: 400 });
      }

      // Mínimo de subtotal elegible
      const minTargetSubtotal = Number(promo?.constraints?.minTargetSubtotal);
      if (Number.isFinite(minTargetSubtotal) && minTargetSubtotal > 0) {
        const minCents = toCentsFromAmount(minTargetSubtotal);
        if (targetSub < minCents) {
          return NextResponse.json(
            { ok: false, reason: `Subtotal elegible insuficiente (mínimo ${minTargetSubtotal.toFixed(2)})` },
            { status: 400 }
          );
        }
      }

      baseCents = targetSub;

      // Estructura para prorrateo
      discountByLine = lines.map((ln, i) => ({
        lineId: ln.lineId ?? String(i),
        menuItemId: ln.menuItemId,
        discountCents: 0,
        eligible: !!eligibleFlags[i],
        lineSubtotalCents: subtotals[i],
      }));
    } else {
      const minTargetSubtotal = Number(promo?.constraints?.minTargetSubtotal);
      if (Number.isFinite(minTargetSubtotal) && minTargetSubtotal > 0) {
        const minCents = toCentsFromAmount(minTargetSubtotal);
        if (baseCents < minCents) {
          return NextResponse.json(
            { ok: false, reason: `Subtotal insuficiente (mínimo ${minTargetSubtotal.toFixed(2)})` },
            { status: 400 }
          );
        }
      }
    }

    // -----------------------------------------------------------------------
    // Cálculo del descuento sobre baseCents
    // -----------------------------------------------------------------------
    const type = (promo?.type === "fixed" ? "fixed" : "percent") as "percent" | "fixed";
    const valueNum = Number(promo?.value || 0);

    let discountTotal = 0;
    if (type === "percent") {
      let percent = Math.round(valueNum * 100) / 100;
      const near = Math.round(percent);
      if (Math.abs(percent - near) < 0.05) percent = near;
      if (!(percent > 0 && percent <= 100)) {
        return NextResponse.json({ ok: false, reason: "Porcentaje inválido en promoción" }, { status: 400 });
      }
      discountTotal = Math.round((baseCents * percent) / 100);
      (promo as any)._normalizedPercent = percent;
    } else {
      const fixedCents = toCentsFromAmount(valueNum);
      discountTotal = Math.min(fixedCents, baseCents);
    }

    if (discountTotal <= 0) {
      return NextResponse.json({ ok: false, reason: "El descuento calculado es cero" }, { status: 400 });
    }

    if (discountByLine.length > 0) {
      const weights = discountByLine.map((d) => (d.eligible ? d.lineSubtotalCents : 0));
      const perLineEligible = splitProportional(discountTotal, weights);
      discountByLine = discountByLine.map((d, i) => ({ ...d, discountCents: perLineEligible[i] || 0 }));
    }

    const pctForMsg =
      type === "percent"
        ? (typeof (promo as any)?._normalizedPercent === "number" ? (promo as any)._normalizedPercent : valueNum)
        : undefined;

    const message = type === "percent"
      ? `${pctForMsg}% aplicado sobre subtotal`
      : `${(valueNum).toFixed(2)} aplicado sobre subtotal`;

    const infoLimits = {
      globalLimit: Number.isFinite(globalLimit) ? globalLimit : undefined,
      perUserLimit: Number.isFinite(perUserLimit) ? perUserLimit : undefined,
    };

    return NextResponse.json({
      ok: true,
      promoId: promo.id,
      code,
      type,
      value: type === "percent" ? pctForMsg : valueNum,
      discountTotalCents: discountTotal,
      discountByLine,
      appliedScope: undefined,
      limits: infoLimits,
      message,
    });
  } catch (e: any) {
    console.error("[apply-promo] error", e);
    return NextResponse.json({ ok: false, reason: e?.message || "Error interno" }, { status: 500 });
  }
}
