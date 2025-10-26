// src/app/(tenant)/[tenant]/app/api/marketing/brevo/sync-contacts/route.ts
export const runtime = "nodejs";

import { NextRequest } from "next/server";

// ✅ Guard / tenancy
import { json, requireAdmin, forbiddenDebug } from "../_guard";
import { resolveTenantFromRequest, requireTenantId } from "@/lib/tenant/server";

// ✅ Firestore Admin
import { getAdminDB } from "@/lib/firebase/admin";

// ✅ Brevo
import { upsertContacts } from "@/lib/marketing/brevo";

function normEmail(v: unknown) {
  if (!v || typeof v !== "string") return null;
  const e = v.trim().toLowerCase();
  return e.includes("@") ? e : null;
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
  // 1) Resolver tenant y validar admin del tenant
  const tenantId = requireTenantId(
    resolveTenantFromRequest(req, ctx.params),
    "api:marketing/brevo/sync-contacts:POST"
  );
  if (req.headers.get("x-debug-auth") === "1") {
    console.log("[SYNC-CONTACTS] tenantId:", tenantId);
  }
  const me = await requireAdmin(req, { tenantId });
  if (!me) {
    return forbiddenDebug(req, { route: "sync-contacts", tenantId });
  }

  try {
    // 2) Flags de query
    const qp = new URL(req.url).searchParams;
    const includeAll = qp.get("includeAll") === "1";

    // 3) Config por tenant (listId)
    const db = getAdminDB();
    const cfgSnap = await db.doc(`tenants/${tenantId}/system_flags/marketing`).get();
    const cfg = (cfgSnap.exists ? cfgSnap.data() : null) as { listId?: number | string } | null;
    const listIdNum = cfg?.listId != null ? Number(cfg.listId) : NaN;
    if (!Number.isFinite(listIdNum)) {
      return json({ error: "Missing marketing listId. Run setup first." }, 400);
    }

    // 4) Obtener customers del tenant
    const snap = await db.collection(`tenants/${tenantId}/customers`).get();

    const contacts: Array<{
      email: string;
      firstName?: string;
      lastName?: string;
      attributes?: Record<string, any>;
    }> = [];
    let skippedNoEmail = 0,
      skippedNoOptin = 0;

    snap.forEach((d) => {
      const c = d.data() as any;
      if (!c) return;

      const email =
        normEmail(c.email) ||
        normEmail(c.userEmail) ||
        normEmail(c.user_email) ||
        normEmail(c.userEmail_lower) ||
        normEmail(c.contact?.email) ||
        normEmail(c.profile?.email);

      if (!email) {
        skippedNoEmail++;
        return;
      }

      const opt =
        c.marketingOptIn === true ||
        c.optIn === true ||
        c.marketing?.optIn === true;

      if (!includeAll && !opt) {
        skippedNoOptin++;
        return;
      }

      const name = (c.name || c.displayName || "").trim();
      const { firstName, lastName } = {
        firstName: c.firstName || (name ? splitName(name).firstName : ""),
        lastName: c.lastName || (name ? splitName(name).lastName : ""),
      };

      contacts.push({
        email,
        firstName,
        lastName,
        attributes: {
          UID: d.id,
          SOURCE: "firestore_customers",
          OPTIN: opt ? "yes" : "no",
          TENANT: tenantId,
        },
      });
    });

    if (contacts.length === 0) {
      return json({
        ok: true,
        tenantId,
        total: 0,
        created: 0,
        updated: 0,
        failed: [],
        skippedNoEmail,
        skippedNoOptin,
      });
    }

    // 5) Upsert en Brevo (lista del tenant)
    const res = await upsertContacts(contacts, listIdNum);

    // 6) Auditoría por tenant (no bloquear si falla)
    try {
      await db.collection(`tenants/${tenantId}/_admin_audit`).add({
        type: "marketing.syncContacts",
        provider: "brevo",
        tenantId,
        at: new Date(),
        by: me.uid,
        actorEmail: me.email ?? null,
        includeAll,
        total: contacts.length,
        result: { created: res.created, updated: res.updated, failed: (res.failed || []).length },
        skipped: { skippedNoEmail, skippedNoOptin },
        origin: "api",
        path: "marketing/brevo/sync-contacts",
      });
    } catch {}

    return json({
      ok: true,
      tenantId,
      total: contacts.length,
      created: res.created,
      updated: res.updated,
      failed: res.failed,
      skippedNoEmail,
      skippedNoOptin,
    });
  } catch (e: any) {
    // Log de error scopiado (best-effort)
    try {
      const db = getAdminDB();
      await db.collection(`tenants/${tenantId}/_admin_audit`).add({
        type: "marketing.syncContacts.error",
        provider: "brevo",
        tenantId,
        at: new Date(),
        by: me?.uid ?? null,
        error: e?.message ?? String(e),
      });
    } catch {}
    return json({ error: e?.message || "Sync error" }, 500);
  }
}
