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

/** GET /campaigns?limit=20&offset=0[&filterByTenant=1]
 *  Retrocompatible: por defecto devuelve el JSON tal cual de Brevo.
 *  Si agregas filterByTenant=1, filtra por nombre que comience con [tenantId].
 */
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
    const filterByTenant = sp.get("filterByTenant") === "1";

    const data = await listCampaigns(limit, offset);

    if (!filterByTenant) {
      // 🔁 Comportamiento previo intacto
      return json({ ok: true, tenantId, ...data });
    }

    // 🔎 Modo opcional: filtra por prefijo de nombre [tenantId]
    const campaigns = Array.isArray((data as any)?.campaigns)
      ? (data as any).campaigns.filter(
          (c: any) => String(c?.name || "").startsWith(`[${tenantId}]`)
        )
      : [];

    return json({ ok: true, tenantId, campaigns, raw: data });
  } catch (e: any) {
    return json({ error: e?.message || "List error" }, 500);
  }
}

/** POST /campaigns  { subject, html, [attachmentUrl], [previewText], [name] }
 *  Retrocompatible:
 *    - Mantiene subject/html obligatorios
 *    - Mantiene previewText, name (si lo envías, se respeta), attachmentUrl validado
 *  Mejoras tenant-safe:
 *    - Usa senderName/senderEmail del tenant si están en system_flags/marketing
 *    - Si NO envías "name", se arma uno con prefijo: namePrefixed = `[tenantId] ${subject}`
 *    - Registra doc local en tenants/{tenantId}/marketing_campaigns/{id}
 */
export async function POST(req: NextRequest, ctx: Ctx) {
  const tenantId = requireTenantId(
    resolveTenantFromRequest(req, ctx.params),
    "api:marketing/brevo/campaigns:POST"
  );

  const me = await requireAdmin(req, { tenantId });
  if (!me) return json({ error: "Forbidden" }, 403);

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
    // Puedes usar adminDbFromGuard o getAdminDB indistintamente (Admin SDK)
    const db = adminDbFromGuard ?? getAdminDB();
    const cfgSnap = await db.doc(`tenants/${tenantId}/system_flags/marketing`).get();
    const cfg = (cfgSnap.exists ? cfgSnap.data() : null) as {
      listId?: number | string;
      senderName?: string;
      senderEmail?: string;
      // futuro: flags como { prefixNames?: boolean }
    } | null;

    const listIdNum = cfg?.listId != null ? Number(cfg.listId) : NaN;
    if (!Number.isFinite(listIdNum)) {
      return json({ error: "Missing marketing listId. Run setup first." }, 400);
    }

    // Remitente: primero tenant, luego env (retrocompat)
    const senderName = cfg?.senderName || process.env.BREVO_SENDER_NAME || "OrderCraft";
    const senderEmail = cfg?.senderEmail || process.env.BREVO_SENDER_EMAIL;
    if (!senderEmail) return json({ error: "Missing BREVO_SENDER_EMAIL env" }, 500);

    // Retrocompat: si envías name en el body, se respeta.
    // Si no, creamos uno con prefijo (no tocamos subject para no romper tu UI/entregabilidad)
    const nameRaw = typeof body?.name === "string" && body.name.trim() ? body.name.trim() : subject;
    const namePrefixed = `[${tenantId}] ${nameRaw}`;

    // Construir payload saneado para Brevo
    // ⚠️ tu createCampaign actual acepta objeto "amplio" (retrocompat con tu versión que soporta previewText/attachmentUrl)
    const payload: any = {
      // subject/ htmlContent obligatorios
      subject,
      htmlContent: html,
      listId: listIdNum,
      senderName,
      senderEmail,

      // name: si viene en body se respeta, si no usamos el prefijado
      name: typeof body?.name === "string" && body.name.trim() ? body.name.trim() : namePrefixed,
    };

    // Opcionales válidos
    if (body?.previewText && typeof body.previewText === "string") {
      payload.previewText = body.previewText.slice(0, 250);
    }

    // ✅ Importante: solo incluir attachmentUrl si es https público válido
    if (isValidPublicUrl(body?.attachmentUrl)) {
      payload.attachmentUrl = body!.attachmentUrl;
    }

    // Crear campaña en Brevo
    const created = await createCampaign(payload);

    // Registro local por tenant (no rompe nada existente; solo agrega tracking)
    try {
      const docRef = db.doc(`tenants/${tenantId}/marketing_campaigns/${created?.id ?? "unknown"}`);
      await docRef.set(
        {
          id: created?.id ?? null,
          subject,             // sujeto real (sin prefijo)
          name: payload.name,  // el name que se envió a Brevo
          namePrefixed,        // útil si BODY no traía name (documentamos cuál prefijamos)
          listId: listIdNum,
          senderName,
          senderEmail,
          brevo: {
            status: created?.status ?? null,
            name: created?.name ?? payload.name,
            internal: created || null,
          },
          tenantId,
          createdAt: new Date(),
          createdBy: me.uid ?? null,
          createdByEmail: (me as any)?.email ?? null,
          updatedAt: new Date(),
        },
        { merge: true }
      );
    } catch {}

    // Audit por tenant (reemplaza app_logs global)
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
