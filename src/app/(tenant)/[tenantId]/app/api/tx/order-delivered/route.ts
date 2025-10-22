// src/app/(tenant)/[tenant]/app/api/tx/order-delivered/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { sendTransactionalEmail } from "@/lib/email/brevoTx";
import { orderDeliveredHtml, orderDeliveredText } from "@/lib/email/orderDeliveredTemplate";
import { FieldValue } from "firebase-admin/firestore";

// ✅ Tenant helpers
import { resolveTenantFromRequest, requireTenantId } from "@/lib/tenant/server";
// ✅ Firestore Admin (tenant-aware)
import { tColAdmin } from "@/lib/db_admin";
// ✅ Admin Auth
import { adminAuth } from "@/lib/firebase/admin";

const json = (d: unknown, s = 200) => NextResponse.json(d, { status: s });

type OrderDoc = any;

/* ============================================================================
   Helpers de auth/roles robustos por-tenant (mismo patrón que en delivery PATCH)
   ========================================================================== */
function extractClaims(u: any) {
  return u?.claims ?? u?.token ?? u ?? {};
}
function normalizeTenantNode(node: any): Record<string, boolean> {
  if (!node || typeof node !== "object") return {};
  const res: Record<string, boolean> = {};
  const merge = (src: any) => {
    if (src && typeof src === "object") {
      for (const k of Object.keys(src)) if (typeof src[k] === "boolean") res[k] ||= !!src[k];
    }
  };
  merge(node);                // plano {admin:true}
  merge(node.roles);          // {roles:{admin:true}}
  merge(node.flags);          // {flags:{admin:true}}
  merge(node.rolesNormalized);// {rolesNormalized:{admin:true}}
  return res;
}
function hasRoleGlobal(claims: any, role: string) {
  return !!(
    claims?.[role] === true ||
    (Array.isArray(claims?.roles) && claims.roles.includes(role)) ||
    claims?.role === role ||
    (role === "admin" && (claims?.role === "superadmin" || claims?.superadmin === true))
  );
}
function inTenant(claims: any, tenantId: string) {
  if (!claims) return false;
  if (claims.tenantId && claims.tenantId === tenantId) return true;
  if (claims.tenants && claims.tenants[tenantId]) return true;
  return false;
}
function hasAnyTenantRole(claims: any, tenantId: string, roles: string[]) {
  const flags = normalizeTenantNode(claims?.tenants?.[tenantId]);
  return roles.some((r) => !!flags[r]);
}
async function getClaimsFromAuthHeader(req: NextRequest) {
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : null;
  if (!token) return null;
  try {
    const decoded = await adminAuth.verifyIdToken(token, false);
    return { uid: decoded.uid, claims: extractClaims(decoded) };
  } catch {
    return null;
  }
}
async function ensureTenantAwareClaims(baseClaims: any, uid: string | null, tenantId: string) {
  let claims = extractClaims(baseClaims);
  const hasTenantNode = !!claims?.tenants?.[tenantId];
  if (!hasTenantNode && uid) {
    try {
      const rec = await adminAuth.getUser(uid);
      const cc = rec?.customClaims || {};
      claims = { ...claims, ...cc };
    } catch {}
  }
  return claims;
}

/* ============================================================================
   Lógica de negocio existente (sin cambios)
   ========================================================================== */
function isDeliveryOrder(o: OrderDoc) {
  const t = o?.orderInfo?.type?.toLowerCase?.();
  if (t) return t === "delivery";
  return !!(o?.orderInfo?.address || o?.deliveryAddress || o?.type === "delivery");
}
function isDelivered(o: OrderDoc) {
  const sub = String(o?.orderInfo?.delivery || "").toLowerCase();
  if (sub === "delivered") return true;

  const status = String(o?.status || "").toLowerCase();
  if (status === "delivered" || status === "closed") return true;

  if (o?.deliveredAt || o?.deliveryDeliveredAt || o?.orderInfo?.deliveredAt || o?.orderInfo?.deliveryAt) return true;

  const hist: any[] = Array.isArray(o?.statusHistory) ? o.statusHistory : [];
  const hit = hist.find(
    (h) =>
      String(h?.to || "").toLowerCase() === "delivered" ||
      String(h?.to || "").toLowerCase() === "closed"
  );
  return !!hit;
}
function getRecipientEmail(o: OrderDoc): string | null {
  return (
    (o?.createdBy?.email && String(o.createdBy.email)) ||
    (o?.orderInfo?.email && String(o.orderInfo.email)) ||
    (o?.orderInfo?.contactEmail && String(o.orderInfo.contactEmail)) ||
    (o?.userEmail && String(o.userEmail)) ||
    (o?.userEmail_lower && String(o.userEmail_lower)) ||
    null
  );
}
function getCustomerName(o: OrderDoc): string | undefined {
  return o?.orderInfo?.customerName || undefined;
}

/* ============================================================================
   Handler
   ========================================================================== */
export async function POST(
  req: NextRequest,
  ctx: { params: { tenant: string } }
) {
  try {
    // 🔐 Tenant
    const tenantId = requireTenantId(
      resolveTenantFromRequest(req, ctx?.params),
      "api:/tx/order-delivered"
    );

    // 🔐 Auth robusto: Bearer → fusiona customClaims → valida pertenencia+rol
    const authInfo = await getClaimsFromAuthHeader(req);
    if (!authInfo) return json({ error: "Unauthorized" }, 401);

    const claims = await ensureTenantAwareClaims(authInfo.claims, authInfo.uid, tenantId);

    if (!inTenant(claims, tenantId)) {
      return json({ error: "Forbidden" }, 403);
    }

    const allowed =
      hasAnyTenantRole(claims, tenantId, ["admin", "delivery", "cashier"]) ||
      hasRoleGlobal(claims, "admin") ||
      hasRoleGlobal(claims, "delivery") ||
      hasRoleGlobal(claims, "cashier");

    if (!allowed) return json({ error: "Forbidden" }, 403);

    // orderId por query o body
    const url = new URL(req.url);
    const idFromQuery = url.searchParams.get("id");
    const body = await req.json().catch(() => ({} as any));
    const orderId = String(body?.orderId || idFromQuery || "").trim();
    if (!orderId) return json({ error: "Missing orderId" }, 400);

    // 📄 Cargar orden (tenant-scoped)
    const ref = tColAdmin("orders", tenantId).doc(orderId);
    const snap = await ref.get();
    if (!snap.exists) return json({ error: "Order not found" }, 404);
    const order = { id: snap.id, ...(snap.data() || {}) } as OrderDoc;

    // Defensa: que el doc pertenezca al tenant (si tu modelo lo guarda)
    if (order.tenantId && order.tenantId !== tenantId) {
      return json({ error: "Order does not belong to tenant" }, 403);
    }

    // Debe ser delivery
    if (!isDeliveryOrder(order)) {
      return json({ ok: true, skipped: true, reason: "Not a delivery order", orderId }, 200);
    }

    // Debe estar delivered (reglas ampliadas)
    if (!isDelivered(order)) {
      return json(
        {
          ok: true,
          skipped: true,
          reason: "Order is not delivered yet (no delivered signal found)",
          hints: {
            expectAnyOf: [
              "orderInfo.delivery === 'delivered'",
              "status === 'delivered' or 'closed'",
              "deliveredAt / deliveryDeliveredAt present",
              "statusHistory contains 'delivered' or 'closed'",
            ],
          },
          orderId,
        },
        200
      );
    }

    // Idempotencia
    const tx = (order as any).tx || {};
    if (tx?.deliveredEmailSentAt) {
      return json({ ok: true, alreadySent: true, at: tx.deliveredEmailSentAt, orderId }, 200);
    }

    // Destinatario
    let toEmail = getRecipientEmail(order);
    if (!toEmail && order?.createdBy?.uid) {
      const cSnap = await tColAdmin("customers", tenantId)
        .doc(String(order.createdBy.uid))
        .get();
      if (cSnap.exists) {
        const c = cSnap.data() as any;
        if (c?.email) toEmail = String(c.email);
      }
    }
    if (!toEmail) return json({ error: "No recipient email found for this order", orderId }, 400);

    const displayName = getCustomerName(order) || undefined;

    // ✉️ Render template
    const html = orderDeliveredHtml(order);
    const text = orderDeliveredText(order);
    const subject = `Your order has been delivered — #${order.orderNumber || order.id}`;

    // Enviar
    const { messageId } = await sendTransactionalEmail({
      toEmail,
      toName: displayName,
      subject,
      html,
      text,
    });

    // Marcar idempotencia (tenant-scoped + timestamps server)
    const patch = {
      tenantId,
      tx: {
        ...(tx || {}),
        deliveredEmailSentAt: FieldValue.serverTimestamp(),
        deliveredMessageId: messageId || null,
      },
      updatedAt: FieldValue.serverTimestamp(),
    };
    await ref.set(patch, { merge: true });

    return json({ ok: true, orderId, messageId });
  } catch (e: any) {
    console.error("[POST /api/tx/order-delivered] error:", e);
    return json({ error: e?.message || "Server error" }, 500);
  }
}
