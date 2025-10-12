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

/** POST /campaigns  { subject, html } */
export async function POST(req: NextRequest, ctx: Ctx) {
  const tenantId = requireTenantId(
    resolveTenantFromRequest(req, ctx.params),
    "api:marketing/brevo/campaigns:POST"
  );

  const me = await requireAdmin(req, { tenantId });
  if (!me) return json({ error: "Forbidden" }, 403);

  try {
    const body = await req.json().catch(() => ({} as any));
    const subject = String(body?.subject ?? "").trim();
    const html = String(body?.html ?? "").trim();
    if (!subject || !html) return json({ error: "Missing subject/html" }, 400);

    // Config por tenant (antes era app_config/marketing global)
    const db = getAdminDB(); // o usa adminDbFromGuard; ambos apuntan al Admin SDK
    const cfgSnap = await db.doc(`tenants/${tenantId}/system_flags/marketing`).get();
    const cfg = (cfgSnap.exists ? cfgSnap.data() : null) as { listId?: number | string } | null;
    const listIdNum = cfg?.listId != null ? Number(cfg.listId) : NaN;
    if (!Number.isFinite(listIdNum)) {
      return json({ error: "Missing marketing listId. Run setup first." }, 400);
    }

    const senderName = process.env.BREVO_SENDER_NAME || "OrderCraft";
    const senderEmail = process.env.BREVO_SENDER_EMAIL;
    if (!senderEmail) return json({ error: "Missing BREVO_SENDER_EMAIL env" }, 500);

    const created = await createCampaign({
      subject,
      htmlContent: html,
      listId: listIdNum,
      senderName,
      senderEmail,
    });

    // Audit por tenant (reemplaza app_logs global)
    await db.collection(`tenants/${tenantId}/_admin_audit`).add({
      type: "campaign.created",
      provider: "brevo",
      campaignId: created.id,
      subject,
      tenantId,
      at: new Date(),
      by: me.uid,
      actorEmail: me.email ?? null,
      origin: "api",
      path: "marketing/brevo/campaigns",
    });

    return json({ ok: true, tenantId, campaign: created });
  } catch (e: any) {
    try {
      const db = getAdminDB();
      await db.collection(`tenants/${tenantId}/_admin_audit`).add({
        type: "campaign.created.error",
        provider: "brevo",
        tenantId,
        at: new Date(),
        by: me?.uid ?? null,
        error: e?.message ?? String(e),
      });
    } catch {}
    return json({ error: e?.message || "Create error" }, 500);
  }
}
