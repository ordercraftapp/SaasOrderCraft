// src/app/(tenant)/[tenant]/app/api/marketing/brevo/campaigns/[id]/send-test/route.ts
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { json, requireAdmin } from "../../../_guard";
import { resolveTenantFromRequest, requireTenantId } from "@/lib/tenant/server";
import { getAdminDB } from "@/lib/firebase/admin";
import { sendCampaignTest, upsertContacts } from "@/lib/marketing/brevo";

// Carpeta es [tenant] → el tipo refleja 'tenant'
type Ctx = { params: { tenant: string; id: string } };

export async function POST(req: NextRequest, ctx: Ctx) {
  const tenantId = requireTenantId(
    resolveTenantFromRequest(req, ctx.params),
    "api:marketing/brevo/campaigns/[id]/send-test"
  );

  const me = await requireAdmin(req);
  if (!me) return json({ error: "Forbidden" }, 403);

  try {
    const id = Number(ctx.params.id);
    const body = await req.json().catch(() => ({} as any));

    let emails: string[] = Array.isArray(body?.emailTo)
      ? body.emailTo
      : body?.email
      ? [body.email]
      : [];

    emails = emails
      .filter((e: unknown): e is string => typeof e === "string")
      .map((e) => e.trim().toLowerCase())
      .filter((e) => e.includes("@"));

    if (!emails.length) return json({ error: "Missing emailTo" }, 400);

    const adminDb = getAdminDB();
    const cfgSnap = await adminDb.doc(`tenants/${tenantId}/system_flags/marketing`).get();
    const cfg = (cfgSnap.exists ? cfgSnap.data() : null) as { listId?: number | string } | null;
    const listIdNum = cfg?.listId != null ? Number(cfg.listId) : NaN;
    if (!Number.isFinite(listIdNum)) {
      return json({ error: "Missing marketing listId. Run setup first." }, 400);
    }

    const up = await upsertContacts(
      emails.map((email) => ({ email })),
      listIdNum
    );
    if (up?.failed?.length) {
      const detail = up.failed.map((f: any) => `${f.email}: ${f.error}`).join(", ");
      return json({ error: `No se pudieron preparar estos contactos: ${detail}` }, 400);
    }

    await sendCampaignTest(id, emails);

    await adminDb.collection(`tenants/${tenantId}/_admin_audit`).add({
      type: "campaign.sendTest",
      provider: "brevo",
      campaignId: id,
      emails,
      tenantId,
      at: new Date(),
      by: me.uid,
      actorEmail: me.email ?? null,
      origin: "api",
      path: "marketing/brevo/campaigns/[id]/send-test",
    });

    return json({ ok: true, tenantId, campaignId: id, emails });
  } catch (e: any) {
    try {
      const adminDb = getAdminDB();
      await adminDb.collection(`tenants/${tenantId}/_admin_audit`).add({
        type: "campaign.sendTest.error",
        provider: "brevo",
        tenantId,
        at: new Date(),
        by: null,
        error: e?.message ?? String(e),
      });
    } catch {}
    return json({ error: e?.message || "SendTest error" }, 400);
  }
}
