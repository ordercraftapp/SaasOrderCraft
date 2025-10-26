// src/app/(tenant)/[tenant]/app/api/marketing/brevo/campaigns/[id]/send-test/route.ts
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { json, requireAdmin } from "../../../_guard";
import { resolveTenantFromRequest, requireTenantId } from "@/lib/tenant/server";
import { getAdminDB } from "@/lib/firebase/admin";
import { sendCampaignTest } from "@/lib/marketing/brevo";

type Ctx = { params: { tenant: string; id: string } };

export async function POST(req: NextRequest, ctx: Ctx) {
  const tenantId = requireTenantId(
    resolveTenantFromRequest(req, ctx.params),
    "api:marketing/brevo/campaigns/:id/send-test:POST"
  );

  // ✅ acepta admin/owner/superadmin y también rol "marketing"
  const me = await requireAdmin(req, { tenantId, roles: ["admin", "owner", "superadmin", "marketing"] });
  if (!me) return json({ error: "Forbidden" }, 403);

  const idNum = Number(ctx.params.id);
  if (!Number.isFinite(idNum)) return json({ error: "Invalid campaign id" }, 400);

  const body = await req.json().catch(() => ({} as any));
  let emailTo: string[] = Array.isArray(body?.emailTo) ? body.emailTo : [];
  emailTo = emailTo.map((e) => String(e || "").trim()).filter(Boolean);
  if (emailTo.length === 0) return json({ error: "Missing emailTo[]" }, 400);

  try {
    await sendCampaignTest(idNum, emailTo);

    // Audit
    try {
      const db = getAdminDB();
      await db.collection(`tenants/${tenantId}/_admin_audit`).add({
        type: "campaign.sendTest",
        provider: "brevo",
        tenantId,
        at: new Date(),
        by: me.uid,
        actorEmail: me.email ?? null,
        campaignId: idNum,
        emailTo,
        origin: "api",
        path: "marketing/brevo/campaigns/:id/send-test",
      });
    } catch {}

    return json({ ok: true, tenantId, id: idNum, emailTo });
  } catch (e: any) {
    try {
      const db = getAdminDB();
      await db.collection(`tenants/${tenantId}/_admin_audit`).add({
        type: "campaign.sendTest.error",
        provider: "brevo",
        tenantId,
        at: new Date(),
        by: me?.uid ?? null,
        campaignId: idNum,
        emailTo,
        error: e?.message ?? String(e),
      });
    } catch {}
    return json({ error: e?.message || "Send test error" }, 500);
  }
}
