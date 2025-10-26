export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { json, requireAdmin } from "../_guard";
import { resolveTenantFromRequest, requireTenantId } from "@/lib/tenant/server";
import { getAdminDB } from "@/lib/firebase/admin";

type Ctx = { params: { tenant: string } };

/** GET → retorna { senderName?, senderEmail? } desde tenants/{tenantId}/system_flags/marketing */
export async function GET(req: NextRequest, ctx: Ctx) {
  const tenantId = requireTenantId(
    resolveTenantFromRequest(req, ctx.params),
    "api:marketing/brevo/settings:GET"
  );
  const me = await requireAdmin(req, { tenantId, roles: ["admin", "owner", "superadmin", "marketing"] });
  if (!me) return json({ error: "Forbidden" }, 403);

  const db = getAdminDB();
  try {
    const snap = await db.doc(`tenants/${tenantId}/system_flags/marketing`).get();
    const data = snap.exists ? (snap.data() as any) : {};
    return json({
      ok: true,
      tenantId,
      senderName: data?.senderName || null,
      senderEmail: data?.senderEmail || null,
    });
  } catch (e: any) {
    return json({ error: e?.message || "Read error" }, 500);
  }
}

/** PUT → guarda { senderName?, senderEmail? } (merge) en system_flags/marketing */
export async function PUT(req: NextRequest, ctx: Ctx) {
  const tenantId = requireTenantId(
    resolveTenantFromRequest(req, ctx.params),
    "api:marketing/brevo/settings:PUT"
  );
  const me = await requireAdmin(req, { tenantId, roles: ["admin", "owner", "superadmin", "marketing"] });
  if (!me) return json({ error: "Forbidden" }, 403);

  const db = getAdminDB();
  try {
    const body = await req.json().catch(() => ({}));
    const senderName =
      typeof body?.senderName === "string" ? body.senderName.trim().slice(0, 120) : undefined;
    const senderEmail =
      typeof body?.senderEmail === "string" ? body.senderEmail.trim().toLowerCase() : undefined;

    // Validaciones suaves (no rompemos flujo si van vacíos – simplemente se guardan null/undefined)
    if (senderEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(senderEmail)) {
      return json({ error: "Invalid senderEmail format" }, 400);
    }

    const payload: any = {
      updatedAt: new Date(),
      updatedBy: me.uid ?? null,
      updatedByEmail: (me as any)?.email ?? null,
    };
    if (senderName !== undefined) payload.senderName = senderName || null;
    if (senderEmail !== undefined) payload.senderEmail = senderEmail || null;

    await db.doc(`tenants/${tenantId}/system_flags/marketing`).set(payload, { merge: true });

    // Auditoría
    try {
      await db.collection(`tenants/${tenantId}/_admin_audit`).add({
        type: "marketing.settings.updated",
        provider: "brevo",
        tenantId,
        at: new Date(),
        by: me.uid,
        actorEmail: (me as any)?.email ?? null,
        changes: Object.keys(payload),
        origin: "api",
        path: "marketing/brevo/settings",
      });
    } catch {}

    return json({ ok: true, tenantId, saved: { senderName, senderEmail } });
  } catch (e: any) {
    return json({ error: e?.message || "Write error" }, 500);
  }
}
