// src/app/(tenant)/[tenant]/app/api/marketing/brevo/campaigns/route.ts
export const runtime = "nodejs";

import { NextRequest } from "next/server";

// Guard / helpers (mismo patrón que en los otros endpoints)
import { json, requireAdmin, db as adminDbFromGuard } from "../_guard";
import { resolveTenantFromRequest, requireTenantId } from "@/lib/tenant/server";
import { getAdminDB } from "@/lib/firebase/admin";

// Brevo SDK wrappers existentes
import { createCampaign, listCampaigns } from "@/lib/marketing/brevo";

// La carpeta es [tenant] → params.tenant
type Ctx = { params: { tenant: string } };

/** Valida que una URL sea https pública (sin localhost, sin data/blob/file) */
function isValidPublicUrl(u?: string) {
  if (!u || typeof u !== "string") return false;
  try {
    const url = new URL(u);
    if (url.protocol !== "https:") return false;
    // Evitar localhost y 127.0.0.1
    if (
      url.hostname === "localhost" ||
      url.hostname === "127.0.0.1" ||
      url.hostname.endsWith(".localhost")
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Devuelve la fecha de inicio del mes UTC actual (ej. 2025-10-01T00:00:00.000Z) */
function monthStartUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0));
}

/** GET /campaigns?limit=20&offset=0 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const tenantId = requireTenantId(
    resolveTenantFromRequest(req, ctx.params),
    "api:marketing/brevo/campaigns:GET"
  );

  const me = await requireAdmin(req, { tenantId });
  if (!me) return json({ error: "Forbidden" }, 403);

  try {
    const sp = new URL(req.url).searchParams;
    const limit = Number(sp.get("limit") ?? 20);
    const offset = Number(sp.get("offset") ?? 0);

    const data = await listCampaigns(limit, offset);
    return json({ ok: true, tenantId, ...data });
  } catch (e: any) {
    return json({ error: e?.message || "List error" }, 500);
  }
}

/** POST /campaigns  { subject, html, [attachmentUrl], [previewText], [name] }
 *  + Límite mensual por tenant (por defecto 5; override opcional en system_flags/marketing.maxCampaignsPerMonth)
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const tenantId = requireTenantId(
    resolveTenantFromRequest(req, ctx.params),
    "api:marketing/brevo/campaigns:POST"
  );

  const me = await requireAdmin(req, { tenantId });
  if (!me) return json({ error: "Forbidden" }, 403);

  // Admin SDK (puedes usar adminDbFromGuard o getAdminDB indistintamente)
  const db = adminDbFromGuard ?? getAdminDB();

  try {
    const body = (await req.json().catch(() => ({}))) as {
      subject?: string;
      html?: string;
      attachmentUrl?: string;
      previewText?: string;
      name?: string;
    };

    const subject = String(body?.subject ?? "").trim();
    const html = String(body?.html ?? "").trim();
    if (!subject || !html) return json({ error: "Missing subject/html" }, 400);

    // Config por tenant (antes era app_config/marketing global)
    const cfgSnap = await db.doc(`tenants/${tenantId}/system_flags/marketing`).get();
    const cfg = (cfgSnap.exists ? cfgSnap.data() : null) as {
      listId?: number | string;
      maxCampaignsPerMonth?: number;
      senderName?: string;
      senderEmail?: string;
    } | null;

    const listIdNum = cfg?.listId != null ? Number(cfg.listId) : NaN;
    if (!Number.isFinite(listIdNum)) {
      return json({ error: "Missing marketing listId. Run setup first." }, 400);
    }

    const senderName = cfg?.senderName || process.env.BREVO_SENDER_NAME || "OrderCraft";
    const senderEmail = cfg?.senderEmail || process.env.BREVO_SENDER_EMAIL;
    if (!senderEmail) return json({ error: "Missing BREVO_SENDER_EMAIL env" }, 500);

    // ─────────────────────────────────────────────────────────────
    // LÍMITE MENSUAL (mínimo invasivo)
    // ─────────────────────────────────────────────────────────────
    const monthStart = monthStartUtc();
    const maxPerMonth = (cfg?.maxCampaignsPerMonth && Number(cfg.maxCampaignsPerMonth)) || 5;

    // Contar campañas del mes actual en la colección local
    // Estructura esperada: tenants/{tenantId}/marketing_campaigns/{campaignId} con createdAt: Date
    const agg = db
      .collection(`tenants/${tenantId}/marketing_campaigns`)
      .where("createdAt", ">=", monthStart)
      .count();

    const aggSnap = await agg.get();
    const monthlyCount = aggSnap.data().count || 0;

    if (monthlyCount >= maxPerMonth) {
      // 409 Conflict para indicar que no es un error del servidor sino un límite de negocio
      return json(
        {
          error: "Monthly campaign limit reached",
          details: {
            tenantId,
            monthStart: monthStart.toISOString(),
            used: monthlyCount,
            limit: maxPerMonth,
          },
        },
        409
      );
    }
    // ─────────────────────────────────────────────────────────────

    // Construir payload saneado para Brevo
    const payload: any = {
      subject,
      htmlContent: html,
      listId: listIdNum,
      senderName,
      senderEmail,
    };

    // Opcionales válidos
    if (body?.previewText && typeof body.previewText === "string") {
      payload.previewText = body.previewText.slice(0, 250);
    }
    if (body?.name && typeof body.name === "string") {
      payload.name = body.name.slice(0, 200);
    }

    // ✅ Importante: solo incluir attachmentUrl si es https público válido
    if (isValidPublicUrl(body?.attachmentUrl)) {
      payload.attachmentUrl = body!.attachmentUrl;
    }

    // Crear campaña en Brevo
    const created = await createCampaign(payload);

    // Registrar localmente la campaña (para listados y futuros conteos)
    try {
      const docRef = db.doc(`tenants/${tenantId}/marketing_campaigns/${created?.id ?? String(Date.now())}`);
      await docRef.set(
        {
          id: created?.id ?? null,
          tenantId,
          subject,
          name: payload.name ?? created?.name ?? subject,
          listId: listIdNum,
          senderName,
          senderEmail,
          brevo: {
            status: created?.status ?? null,
            internal: created || null,
          },
          createdAt: new Date(), // usado por el conteo mensual
          createdBy: me.uid ?? null,
          createdByEmail: (me as any)?.email ?? null,
          updatedAt: new Date(),
        },
        { merge: true }
      );
    } catch {
      // no bloquear por error de registro local
    }

    // Audit por tenant
    try {
      await db.collection(`tenants/${tenantId}/_admin_audit`).add({
        type: "campaign.created",
        provider: "brevo",
        campaignId: created?.id ?? null,
        subject,
        tenantId,
        at: new Date(),
        by: me.uid,
        actorEmail: (me as any)?.email ?? null,
        origin: "api",
        path: "marketing/brevo/campaigns",
      });
    } catch {}

    return json({ ok: true, tenantId, campaign: created });
  } catch (e: any) {
    // Intentar ampliar mensaje de error si viene de Brevo
    let msg = e?.message || "Create error";
    try {
      const asText = e?.response?.text ? await e.response.text() : null;
      if (asText) msg = `[Brevo] ${msg}: ${asText}`;
    } catch {}
    try {
      const db = adminDbFromGuard ?? getAdminDB();
      await db.collection(`tenants/${tenantId}/_admin_audit`).add({
        type: "campaign.created.error",
        provider: "brevo",
        tenantId,
        at: new Date(),
        by: me?.uid ?? null,
        error: msg,
      });
    } catch {}
    return json({ error: msg }, 500);
  }
}
