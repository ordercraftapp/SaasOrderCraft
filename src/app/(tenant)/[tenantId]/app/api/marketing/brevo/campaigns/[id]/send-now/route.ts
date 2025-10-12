// src/app/(tenant)/[tenantId]/app/api/marketing/brevo/campaigns/[id]/send-now/route.ts
export const runtime = "nodejs";

import { NextRequest } from "next/server";

// ✅ Guard/JSON helpers (sin cambios)
import { json, requireAdmin } from "../../../_guard";

// ✅ Tenancy helpers (tu import estándar)
import { resolveTenantFromRequest, requireTenantId } from "@/lib/tenant/server";

// ✅ Firestore Admin
import { getAdminDB } from "@/lib/firebase/admin";

// Lógica existente
import { sendCampaignNow } from "@/lib/marketing/brevo";

// 👇 OJO: la carpeta es [tenantId] ⇒ el tipo refleja { tenantId: string }
type Ctx = {
  params: { tenantId: string; id: string };
};

export async function POST(req: NextRequest, ctx: Ctx) {
  // 1) Resolver y exigir tenantId desde request + params
  const tenantId = requireTenantId(
    resolveTenantFromRequest(req, ctx.params),
    "api:marketing/brevo/campaigns/[id]/send-now"
  );

  // 2) Auth admin scopiado al tenant
  const me = await requireAdmin(req);
  if (!me) return json({ error: "Forbidden" }, 403);

  try {
    // 3) Params
    const id = Number(ctx.params.id);

    // 4) Acción (si luego tu lib acepta tenantId, pásalo)
    // await sendCampaignNow(tenantId, id);
    await sendCampaignNow(id);

    // 5) Auditoría por tenant
    const db = getAdminDB();
    await db.collection(`tenants/${tenantId}/_admin_audit`).add({
      type: "campaign.sendNow",
      provider: "brevo",
      campaignId: id,
      tenantId,
      at: new Date(),
      by: me.uid,
      actorEmail: me.email ?? null,
      origin: "api",
      path: "marketing/brevo/campaigns/send-now",
    });

    return json({ ok: true, tenantId, campaignId: id });
  } catch (e: any) {
    // 6) Log de error también scopiado al tenant (no enmascara error original)
    try {
      const db = getAdminDB();
      await db.collection(`tenants/${tenantId}/_admin_audit`).add({
        type: "campaign.sendNow.error",
        provider: "brevo",
        tenantId,
        at: new Date(),
        by: me?.uid ?? null,
        error: e?.message ?? String(e),
      });
    } catch {}
    return json({ error: e?.message || "Send error" }, 500);
  }
}
