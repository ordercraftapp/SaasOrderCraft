export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { json, requireAdmin } from "../../_guard"; // <- ojo a la ruta relativa
import { resolveTenantFromRequest, requireTenantId } from "@/lib/tenant/server";
import { getAdminDB } from "@/lib/firebase/admin";

type Ctx = { params: { tenant: string } };

/** GET /marketing/brevo/campaigns/local?limit=20&offset=0
 *  Devuelve campañas desde Firestore: tenants/{tenantId}/marketing_campaigns
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  const tenantId = requireTenantId(
    resolveTenantFromRequest(req, ctx.params),
    "api:marketing/brevo/campaigns/local:GET"
  );

  const me = await requireAdmin(req, { tenantId, roles: ["admin", "owner", "superadmin", "marketing"] });
  if (!me) return json({ error: "Forbidden" }, 403);

  const sp = new URL(req.url).searchParams;
  const limit = Math.max(1, Math.min(100, Number(sp.get("limit") ?? 20)));
  const offset = Math.max(0, Number(sp.get("offset") ?? 0));

  try {
    const db = getAdminDB();
    // Paginación simple: orden por createdAt desc y aplica offset/limit
    const snap = await db
      .collection(`tenants/${tenantId}/marketing_campaigns`)
      .orderBy("createdAt", "desc")
      .offset(offset)
      .limit(limit)
      .get();

    const items = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
    return json({ ok: true, tenantId, items, limit, offset });
  } catch (e: any) {
    return json({ error: e?.message || "List local error" }, 500);
  }
}
