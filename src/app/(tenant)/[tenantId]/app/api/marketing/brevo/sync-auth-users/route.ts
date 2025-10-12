// src/app/(tenant)/[tenant]/app/api/marketing/brevo/sync-auth-users/route.ts
export const runtime = "nodejs";

import { NextRequest } from "next/server";

// ✅ Guard / tenancy
import { json, requireAdmin } from "../_guard";
import { resolveTenantFromRequest, requireTenantId } from "@/lib/tenant/server";

// ✅ Admin SDKs
import { getAdminDB, adminAuth } from "@/lib/firebase/admin";

// ✅ Brevo
import { upsertContacts } from "@/lib/marketing/brevo";

/** Lista todos los usuarios de Firebase Auth (paginado) — solo verificados y no deshabilitados */
async function listAllAuthUsers() {
  const acc: Array<{
    uid: string;
    email: string;
    displayName?: string | null;
    emailVerified?: boolean;
    disabled?: boolean;
  }> = [];

  let nextPageToken: string | undefined = undefined;
  do {
    const page = await adminAuth.listUsers(1000, nextPageToken);
    for (const u of page.users) {
      if (!u.email) continue;
      if (u.disabled) continue;
      if (!u.emailVerified) continue; // entregabilidad
      acc.push({
        uid: u.uid,
        email: u.email.toLowerCase(),
        displayName: u.displayName || "",
        emailVerified: u.emailVerified,
        disabled: u.disabled,
      });
    }
    nextPageToken = page.pageToken;
  } while (nextPageToken);

  return acc;
}

function splitName(displayName?: string | null) {
  const dn = (displayName || "").trim();
  if (!dn) return { firstName: "", lastName: "" };
  const parts = dn.split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: "" };
  const firstName = parts.slice(0, -1).join(" ");
  const lastName = parts.slice(-1).join(" ");
  return { firstName, lastName };
}

// 📁 carpeta es [tenant] → params.tenant
type Ctx = { params: { tenant: string } };

export async function POST(req: NextRequest, ctx: Ctx) {
  // 1) Tenant + auth admin scopiado
  const tenantId = requireTenantId(
    resolveTenantFromRequest(req, ctx.params),
    "api:marketing/brevo/sync-auth-users:POST"
  );
  const me = await requireAdmin(req, { tenantId });
  if (!me) return json({ error: "Forbidden" }, 403);

  try {
    // 2) Config por tenant (antes era app_config global)
    const db = getAdminDB();
    const cfgSnap = await db.doc(`tenants/${tenantId}/system_flags/marketing`).get();
    const cfg = (cfgSnap.exists ? cfgSnap.data() : null) as { listId?: number | string } | null;
    const listIdNum = cfg?.listId != null ? Number(cfg.listId) : NaN;
    if (!Number.isFinite(listIdNum)) {
      return json({ error: "Missing marketing listId. Run setup first." }, 400);
    }

    // 3) Listar usuarios de Firebase Auth (verificados)
    const users = await listAllAuthUsers();
    if (users.length === 0) {
      return json({ ok: true, tenantId, total: 0, created: 0, updated: 0, failed: [] });
    }

    // 4) Mapear a contactos Brevo
    const contacts = users.map((u) => {
      const { firstName, lastName } = splitName(u.displayName);
      return {
        email: u.email,
        firstName,
        lastName,
        attributes: {
          UID: u.uid,
          SOURCE: "firebase_auth",
          EMAIL_VERIFIED: u.emailVerified ? "yes" : "no",
          TENANT: tenantId,
        },
      };
    });

    // 5) Upsert en Brevo list del tenant
    const res = await upsertContacts(contacts, listIdNum);

    // 6) Auditoría por tenant
    try {
      await db.collection(`tenants/${tenantId}/_admin_audit`).add({
        type: "marketing.syncAuthUsers",
        provider: "brevo",
        tenantId,
        at: new Date(),
        by: me.uid,
        actorEmail: me.email ?? null,
        result: { total: contacts.length, created: res.created, updated: res.updated, failed: (res.failed || []).length },
        origin: "api",
        path: "marketing/brevo/sync-auth-users",
      });
    } catch {}

    return json({
      ok: true,
      tenantId,
      total: contacts.length,
      created: res.created,
      updated: res.updated,
      failed: res.failed,
    });
  } catch (e: any) {
    // Log de error scopiado
    try {
      const db = getAdminDB();
      await db.collection(`tenants/${tenantId}/_admin_audit`).add({
        type: "marketing.syncAuthUsers.error",
        provider: "brevo",
        tenantId,
        at: new Date(),
        by: me?.uid ?? null,
        error: e?.message ?? String(e),
      });
    } catch {}
    return json({ error: e?.message || "Sync Auth error" }, 500);
  }
}
