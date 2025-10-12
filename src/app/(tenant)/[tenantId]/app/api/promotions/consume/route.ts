// src/app/(tenant)/[tenant]/app/api/promotions/consume/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

// ✅ Tenant helpers (usa el import estándar que definiste)
import { resolveTenantFromRequest, requireTenantId } from "@/lib/tenant/server";

// ✅ Firestore Admin helpers tenant-aware
import { tColAdmin } from "@/lib/db_admin";
import { FieldValue } from "firebase-admin/firestore";

function normCode(s: string) {
  return (s || "").trim().toUpperCase().replace(/\s+/g, "");
}

export async function POST(
  req: NextRequest,
  ctx: { params: { tenant: string } }
) {
  try {
    // ---- Tenant ----
    const tenantId = requireTenantId(
      resolveTenantFromRequest(req, ctx?.params),
      "api:/promotions/consume"
    );

    const body = await req.json().catch(() => ({}));
    const promoId: string = String(body?.promoId || "");
    const codeRaw: string = String(body?.code || "");
    const orderId: string = String(body?.orderId || "");
    const userUid: string | null = body?.userUid ? String(body.userUid) : null;

    const code = normCode(codeRaw);
    if (!promoId || !code || !orderId) {
      return NextResponse.json(
        { ok: false, reason: "Faltan campos: promoId, code y orderId son requeridos." },
        { status: 400 }
      );
    }

    // 1) Verificar orden (scoped) y que tenga la promo aplicada
    const orderRef = tColAdmin("orders", tenantId).doc(orderId);
    const orderSnap = await orderRef.get();
    if (!orderSnap.exists) {
      return NextResponse.json(
        { ok: false, reason: "La orden no existe." },
        { status: 404 }
      );
    }
    const order = orderSnap.data() || {};
    const orderHasPromo =
      (typeof order.promotionCode === "string" && normCode(order.promotionCode) === code) ||
      (Array.isArray(order.appliedPromotions) &&
        order.appliedPromotions.some(
          (p: any) => normCode(p?.code) === code || p?.promoId === promoId
        ));

    if (!orderHasPromo) {
      return NextResponse.json(
        { ok: false, reason: "La orden no tiene esta promoción aplicada." },
        { status: 400 }
      );
    }

    // 2) Transacción: validar y consumir (todo scopiado al tenant)
    const promoRef = tColAdmin("promotions", tenantId).doc(promoId);
    const redemptionRef = promoRef.collection("redemptions").doc(orderId);
    const usageRef = userUid ? promoRef.collection("usages").doc(userUid) : null;

    const result = await tColAdmin("promotions", tenantId).firestore.runTransaction(async (tx) => {
      const [promoSnap, redemptionSnap, usageSnap] = await Promise.all([
        tx.get(promoRef),
        tx.get(redemptionRef),
        usageRef ? tx.get(usageRef) : Promise.resolve(null),
      ]);

      if (!promoSnap.exists) {
        return { ok: false, status: 404, reason: "Promoción no encontrada." } as const;
      }
      const promo = promoSnap.data() as any;

      // Idempotencia: si ya existe redención para esta orden => OK sin volver a descontar
      if (redemptionSnap.exists) {
        const times = Number(promo?.timesRedeemed || 0);
        const gLimit = Number(promo?.constraints?.globalLimit);
        const remaining = Number.isFinite(gLimit) ? Math.max(0, gLimit - times) : null;
        return {
          ok: true,
          alreadyConsumed: true,
          timesRedeemed: times,
          remainingGlobal: remaining,
        } as const;
      }

      // Validaciones de estado de la promo
      const promoCode = normCode(String(promo?.code || ""));
      if (promoCode !== code) {
        return { ok: false, status: 400, reason: "El código no coincide con la promoción." } as const;
      }
      if (promo?.active === false) {
        return { ok: false, status: 400, reason: "La promoción no está activa." } as const;
      }

      const now = new Date();
      const startAt: Date | undefined =
        promo?.startAt?.toDate?.() || (promo?.startAt ? new Date(promo.startAt) : undefined);
      const endAt: Date | undefined =
        promo?.endAt?.toDate?.() || (promo?.endAt ? new Date(promo.endAt) : undefined);
      if (startAt && now < startAt) {
        return { ok: false, status: 400, reason: "La promoción aún no inicia." } as const;
      }
      if (endAt && now > endAt) {
        return { ok: false, status: 400, reason: "La promoción expiró." } as const;
      }

      // Límites
      const times = Number(promo?.timesRedeemed || 0);
      const gLimit = Number(promo?.constraints?.globalLimit);
      const overGlobal = Number.isFinite(gLimit) && times >= gLimit;
      if (overGlobal) {
        return { ok: false, status: 409, reason: "Límite global de la promoción agotado." } as const;
      }

      // perUserLimit (si userUid está disponible)
      const perUserLimit = Number(promo?.constraints?.perUserLimit);
      const usageCount = usageSnap?.exists ? Number(usageSnap?.data()?.count || 0) : 0;
      if (userUid && Number.isFinite(perUserLimit) && usageCount >= perUserLimit) {
        return { ok: false, status: 409, reason: "Límite por usuario alcanzado para esta promoción." } as const;
      }

      // Escribir redención + incrementar contadores (siempre con tenantId)
      tx.set(redemptionRef, {
        tenantId,
        orderId,
        code,
        userUid: userUid || null,
        at: FieldValue.serverTimestamp(),
        orderRef: orderRef,
      });

      tx.update(promoRef, {
        timesRedeemed: FieldValue.increment(1),
        updatedAt: FieldValue.serverTimestamp(),
        // opcional: tenantId (si tu doc promo no lo tiene aún, puedes reforzarlo)
        // tenantId,
      });

      if (userUid) {
        const nextUsage = {
          tenantId,
          count: FieldValue.increment(1),
          lastUsedAt: FieldValue.serverTimestamp(),
        };
        if (usageSnap?.exists) {
          tx.update(usageRef!, nextUsage);
        } else {
          tx.set(usageRef!, nextUsage);
        }
      }

      const remaining = Number.isFinite(gLimit) ? Math.max(0, gLimit - (times + 1)) : null;

      return {
        ok: true,
        alreadyConsumed: false,
        timesRedeemed: times + 1,
        remainingGlobal: remaining,
      } as const;
    });

    if (!result.ok) {
      // Auditoría ligera
      await tColAdmin("_admin_audit", tenantId).add({
        type: "promotion_consume_denied",
        tenantId,
        promoId,
        orderId,
        code,
        reason: result.reason,
        at: FieldValue.serverTimestamp(),
      });
      return NextResponse.json(
        { ok: false, reason: result.reason },
        { status: (result as any).status || 400 }
      );
    }

    // Auditoría OK
    await tColAdmin("_admin_audit", tenantId).add({
      type: "promotion_consume_ok",
      tenantId,
      promoId,
      orderId,
      code,
      at: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({
      ok: true,
      promoId,
      orderId,
      code,
      alreadyConsumed: result.alreadyConsumed,
      timesRedeemed: result.timesRedeemed,
      remainingGlobal: result.remainingGlobal,
    });
  } catch (e: any) {
    console.error("[promotions/consume] error:", e);
    try {
      const tenantId = resolveTenantFromRequest(req, ctx?.params) || "unknown";
      await tColAdmin("_admin_audit", tenantId).add({
        type: "promotion_consume_error",
        tenantId,
        error: String(e?.message || e),
        at: FieldValue.serverTimestamp(),
      });
    } catch {
      /* no-op */
    }
    return NextResponse.json(
      { ok: false, reason: e?.message || "Error interno" },
      { status: 500 }
    );
  }
}
