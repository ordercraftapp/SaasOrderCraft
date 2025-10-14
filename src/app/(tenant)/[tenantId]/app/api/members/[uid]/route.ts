export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { adminDb, FieldValue } from "@/lib/firebase/admin";
import { getUserFromRequest } from "@/lib/server/auth";
import { resolveTenantFromRequest, requireTenantId } from "@/lib/tenant/server";
import { requireTenantAdmin, isValidOpRole } from "@/lib/tenant/authz";

function json(d: unknown, s = 200) { return NextResponse.json(d, { status: s }); }

export async function PUT(req: NextRequest, ctx: { params: { tenantId: string; uid: string } }) {
  try {
    const tenantId = requireTenantId(resolveTenantFromRequest(req, ctx?.params), "api:members/[uid]:PUT");
    const { uid } = ctx.params;
    const me = await getUserFromRequest(req);
    if (!me) return json({ error: "Unauthorized" }, 401);
    await requireTenantAdmin(tenantId, me.uid);

    const body = await req.json().catch(() => ({}));
    const role = String(body?.role || "").toLowerCase();
    if (!isValidOpRole(role)) return json({ error: "Invalid role" }, 400);

    await adminDb.doc(`tenants/${tenantId}/members/${uid}`).set(
      { uid, role, updatedAt: FieldValue.serverTimestamp() },
      { merge: true }
    );
    return json({ ok: true });
  } catch (e: any) {
    return json({ error: e?.message || "Server error" }, 500);
  }
}

export async function DELETE(req: NextRequest, ctx: { params: { tenantId: string; uid: string } }) {
  try {
    const tenantId = requireTenantId(resolveTenantFromRequest(req, ctx?.params), "api:members/[uid]:DELETE");
    const { uid } = ctx.params;
    const me = await getUserFromRequest(req);
    if (!me) return json({ error: "Unauthorized" }, 401);
    await requireTenantAdmin(tenantId, me.uid);

    await adminDb.doc(`tenants/${tenantId}/members/${uid}`).delete();
    return json({ ok: true });
  } catch (e: any) {
    return json({ error: e?.message || "Server error" }, 500);
  }
}
