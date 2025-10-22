// src/app/(tenant)/[tenant]/app/api/orders/[id]/delivery/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getAdminDB, adminAuth } from "@/lib/firebase/admin";
import { FieldValue, Timestamp } from "firebase-admin/firestore";
import { resolveTenantFromRequest, requireTenantId } from "@/lib/tenant/server";

type DeliverySubState = "pending" | "inroute" | "delivered";

type PatchBody = {
  courierName?: string | null;
  delivery?: DeliverySubState;
};

/* ============================================================================
   Helpers de auth/roles robustos por-tenant
   ========================================================================== */

/** Extrae un objeto de claims desde varios posibles envoltorios */
function extractClaims(u: any) {
  // Puede venir como {claims:{...}}, {token:{...}}, o plano
  return u?.claims ?? u?.token ?? u ?? {};
}

/** Normaliza un nodo de tenant para aceptar varias formas:
 *  - plano:        { admin:true, delivery:true }
 *  - roles:        { roles:{ admin:true, delivery:true } }
 *  - flags:        { flags:{ admin:true, delivery:true } }
 *  - rolesNorm:    { rolesNormalized:{ admin:true } }
 */
function normalizeTenantNode(node: any): Record<string, boolean> {
  if (!node || typeof node !== "object") return {};
  const res: Record<string, boolean> = {};
  const merge = (src: any) => {
    if (src && typeof src === "object") {
      for (const k of Object.keys(src)) {
        if (typeof src[k] === "boolean") res[k] ||= !!src[k];
      }
    }
  };
  merge(node); // plano
  merge(node.roles);
  merge(node.flags);
  merge(node.rolesNormalized);
  return res;
}

/** Roles globales de compatibilidad (por si existen) */
function hasRoleGlobal(claims: any, role: string) {
  return !!(
    claims?.[role] === true ||
    (Array.isArray(claims?.roles) && claims.roles.includes(role)) ||
    claims?.role === role ||
    (role === "admin" && (claims?.role === "superadmin" || claims?.superadmin === true))
  );
}

/** ¿El usuario pertenece al tenant? Acepta forms simples y mapa */
function inTenant(claims: any, tenantId: string) {
  if (!claims) return false;
  if (claims.tenantId && claims.tenantId === tenantId) return true;
  if (claims.tenants && claims.tenants[tenantId]) return true;
  return false;
}

/** ¿Tiene alguno de los roles pedidos en el tenant? */
function hasAnyTenantRole(claims: any, tenantId: string, roles: string[]) {
  const flags = normalizeTenantNode(claims?.tenants?.[tenantId]);
  return roles.some((r) => !!flags[r]);
}

/** Decodifica el Authorization header y retorna { uid, claimsDecodificados } */
async function getClaimsFromAuthHeader(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return null;

  try {
    // Nota: verifyIdToken no "refresca" claims, pero nos da uid confiable
    const decoded = await adminAuth.verifyIdToken(token, false);
    return { uid: decoded.uid, claims: extractClaims(decoded) };
  } catch {
    return null;
  }
}

/** Si faltan roles por-tenant en claims decodificados, fusiona con customClaims del usuario */
async function ensureTenantAwareClaims(
  baseClaims: any,
  uid: string | null,
  tenantId: string
) {
  let claims = extractClaims(baseClaims);
  const hasTenantNode = !!claims?.tenants?.[tenantId];

  if (!hasTenantNode && uid) {
    try {
      const rec = await adminAuth.getUser(uid);
      const cc = rec?.customClaims || {};
      // Fusión superficial: preferimos lo más “fresco” de customClaims
      claims = { ...claims, ...cc };
    } catch {
      // ignoramos error; seguiremos con claims base
    }
  }
  return claims;
}

// 📁 carpeta es [tenant] → params.tenant
type Ctx = { params: { tenant: string; id: string } };

/* ============================================================================
   Handler
   ========================================================================== */

// ---------------------------------------------------------------------------
// PATCH /api/orders/[id]/delivery
// ---------------------------------------------------------------------------
export async function PATCH(req: NextRequest, ctx: Ctx) {
  try {
    const tenantId = requireTenantId(
      resolveTenantFromRequest(req, ctx.params),
      "api:orders/[id]/delivery:PATCH"
    );
    const db = getAdminDB();

    // ---------- Auth (robusto) ----------
    const authInfo = await getClaimsFromAuthHeader(req);
    if (!authInfo) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Fusiona con customClaims si el token no trae el nodo del tenant
    const claims = await ensureTenantAwareClaims(authInfo.claims, authInfo.uid, tenantId);

    // Pertenencia al tenant
    if (!inTenant(claims, tenantId)) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Permite admin o delivery en *este* tenant (con fallback global)
    const allowed =
      hasAnyTenantRole(claims, tenantId, ["admin", "delivery"]) ||
      hasRoleGlobal(claims, "admin") ||
      hasRoleGlobal(claims, "delivery");

    if (!allowed) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // ---------- Params / Body ----------
    const orderId = ctx.params.id;
    if (!orderId) {
      return NextResponse.json({ error: "Missing order id" }, { status: 400 });
    }

    let payload: PatchBody;
    try {
      payload = await req.json();
    } catch {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    const { courierName, delivery } = payload;
    if (courierName == null && delivery == null) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    const orderRef = db.collection(`tenants/${tenantId}/orders`).doc(orderId);

    // Sentinel para campos escalares (no dentro de arrays)
    const nowTS = FieldValue.serverTimestamp();
    // Timestamp concreto para usar dentro de arrayUnion (no se permite serverTimestamp allí)
    const now = Timestamp.now();

    const result = await db.runTransaction(async (tx) => {
      const snap = await tx.get(orderRef);
      if (!snap.exists) {
        throw new Error("Order not found");
      }

      const data = snap.data() || {};

      // (Defensa adicional): valida que el doc pertenezca al tenant
      if (data.tenantId && data.tenantId !== tenantId) {
        throw new Error("Order does not belong to tenant");
      }

      const orderInfo = { ...(data.orderInfo || {}) };
      const prevSub: DeliverySubState | undefined = orderInfo.delivery;
      const timeline = { ...(orderInfo.deliveryTimeline || {}) };

      const updates: Record<string, any> = {};
      const eventsToAdd: any[] = [];

      // 1) courierName (si cambia)
      if (typeof courierName !== "undefined") {
        const newName = (courierName ?? null) as string | null;
        if ((orderInfo.courierName ?? null) !== newName) {
          updates["orderInfo.courierName"] = newName;
          // Si no hay pendingAt aún, sellarlo al asignar repartidor
          if (!timeline.pendingAt) {
            updates["orderInfo.deliveryTimeline.pendingAt"] = nowTS;
          }
        }
      }

      // 2) delivery sub-state (si cambia)
      if (delivery && delivery !== prevSub) {
        updates["orderInfo.delivery"] = delivery;

        // Sella timestamps solo si aún no existen (idempotente)
        if (delivery === "pending" && !timeline.pendingAt) {
          updates["orderInfo.deliveryTimeline.pendingAt"] = nowTS;
        }
        if (delivery === "inroute" && !timeline.inrouteAt) {
          if (!timeline.pendingAt) {
            updates["orderInfo.deliveryTimeline.pendingAt"] = nowTS;
          }
          updates["orderInfo.deliveryTimeline.inrouteAt"] = nowTS;
        }
        if (delivery === "delivered" && !timeline.deliveredAt) {
          if (!timeline.pendingAt) {
            updates["orderInfo.deliveryTimeline.pendingAt"] = nowTS;
          }
          if (!timeline.inrouteAt) {
            updates["orderInfo.deliveryTimeline.inrouteAt"] = nowTS;
          }
          updates["orderInfo.deliveryTimeline.deliveredAt"] = nowTS;
        }

        // Bitácora de eventos (usa Timestamp.now() dentro del array)
        eventsToAdd.push({
          state: delivery,
          by: claims?.uid || authInfo.uid,
          courierName:
            typeof courierName !== "undefined"
              ? (courierName ?? null)
              : (orderInfo.courierName ?? null),
          at: now, // <- NO usar serverTimestamp() dentro de arrayUnion
          tenantId,
        });
      }

      // 3) Si solo se asignó courierName y no había pendingAt, sella pendingAt
      if (typeof courierName !== "undefined" && !timeline.pendingAt) {
        updates["orderInfo.deliveryTimeline.pendingAt"] = nowTS;
      }

      if (eventsToAdd.length) {
        updates["orderInfo.deliveryEvents"] = FieldValue.arrayUnion(...eventsToAdd);
      }

      // Siempre persistir tenantId en el documento
      updates["tenantId"] = tenantId;

      if (Object.keys(updates).length === 0) {
        return { ok: true, unchanged: true, id: orderId };
      }

      tx.update(orderRef, updates);
      return { ok: true, id: orderId, updates };
    });

    return NextResponse.json(result, { status: 200 });
  } catch (e: any) {
    console.error("[delivery] PATCH error:", e);
    const msg = e?.message || "Server error";
    const code =
      /not found/i.test(msg) ? 404 :
      /does not belong to tenant/i.test(msg) ? 403 :
      500;
    return NextResponse.json({ error: msg }, { status: code });
  }
}
