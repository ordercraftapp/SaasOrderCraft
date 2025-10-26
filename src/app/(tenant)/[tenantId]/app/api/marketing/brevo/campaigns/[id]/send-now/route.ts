// src/app/(tenant)/[tenant]/app/api/marketing/brevo/campaigns/[id]/send-now/route.ts
export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { json, requireAdmin } from "../../../_guard";
import { resolveTenantFromRequest, requireTenantId } from "@/lib/tenant/server";
import { getAdminDB } from "@/lib/firebase/admin";
import { sendCampaignNow } from "@/lib/marketing/brevo";

type Ctx = { params: { tenant: string; id: string } };

export async function POST(req: NextRequest, ctx: Ctx) {
  const tenantId = requireTenantId(
    resolveTenantFromRequest(req, ctx.params),
    "api:marketing/brevo/campaigns/:id/send-now:POST"
  );

  // ✅ acepta admin/owner/superadmin y también rol "marketing"
  const me = await requireAdmin(req, { tenantId, roles: ["admin", "owner", "superadmin", "marketing"] });
  if (!me) return json({ error: "Forbidden" }, 403);

  const idNum = Number(ctx.params.id);
  if (!Number.isFinite(idNum)) return json({ error: "Invalid campaign id" }, 400);

  try {
    await sendCampaignNow(idNum);

    // Audit
    try {
      const db = getAdminDB();
      await db.collection(`tenants/${tenantId}/_admin_audit`).add({
        type: "campaign.sendNow",
        provider: "brevo",
        tenantId,
        at: new Date(),
        by: me.uid,
        actorEmail: me.email ?? null,
        campaignId: idNum,
        origin: "api",
        path: "marketing/brevo/campaigns/:id/send-now",
      });
    } catch {}

    return json({ ok: true, tenantId, id: idNum });
  } catch (e: any) {
    try {
      const db = getAdminDB();
      await db.collection(`tenants/${tenantId}/_admin_audit`).add({
        type: "campaign.sendNow.error",
        provider: "brevo",
        tenantId,
        at: new Date(),
        by: me?.uid ?? null,
        campaignId: idNum,
        error: e?.message ?? String(e),
      });
    } catch {}
    return json({ error: e?.message || "Send now error" }, 500);
  }
}
