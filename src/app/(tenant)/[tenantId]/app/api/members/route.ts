export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { getUserFromRequest } from "@/lib/server/auth";
import { resolveTenantFromRequest, requireTenantId } from "@/lib/tenant/server";
import { requireTenantAdmin } from "@/lib/tenant/authz";

function json(d: unknown, s = 200) { return NextResponse.json(d, { status: s }); }

export async function GET(req: NextRequest, ctx: { params: { tenantId: string } }) {
  try {
    const tenantId = requireTenantId(resolveTenantFromRequest(req, ctx?.params), "api:members:GET");
    const me = await getUserFromRequest(req);
    if (!me) return json({ error: "Unauthorized" }, 401);
    await requireTenantAdmin(tenantId, me.uid);

    const snap = await adminDb.collection(`tenants/${tenantId}/members`).get();
    const members = snap.docs.map(d => ({ id: d.id, ...(d.data() as any) }));
    return json({ ok: true, members });
  } catch (e: any) {
    return json({ error: e?.message || "Server error" }, 500);
  }
}
