// src/app/(tenant)/[tenant]/app/api/marketing/brevo/sync-all/route.ts
export const runtime = "nodejs";

import { NextRequest } from "next/server";

// ✅ Guard / tenancy
import { json, requireAdmin, forbiddenDebug } from "../_guard";
import { resolveTenantFromRequest, requireTenantId } from "@/lib/tenant/server";

// ✅ Firestore Admin & Auth Admin
import { getAdminDB, adminAuth } from "@/lib/firebase/admin";

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

async function listAllAuthUsers() {
  const acc: Array<{ email: string; firstName?: string; lastName?: string; attributes?: Record<string, any> }> = [];
  let nextPageToken: string | undefined = undefined;
  do {
    const page = await adminAuth.listUsers(1000, nextPageToken);
    for (const u of page.users) {
      const email = normEmail(u.email);
      if (!email) continue;
      if (u.disabled) continue;
      // Por entregabilidad: prioriza verificados
      if (!u.emailVerified) continue;
      const { firstName, lastName } = splitName(u.displayName);
      acc.push({
        email,
        firstName,
        lastName,
        attributes: { UID: u.uid, SOURCE: "firebase_auth", EMAIL_VERIFIED: u.emailVerified ? "yes" : "no" },
      });
    }
    nextPageToken = page.pageToken;
  } while (nextPageToken);
  return acc;
}

async function listAllCustomers(tenantId: string, includeAll: boolean) {
  const db = getAdminDB();
  const snap = await db.collection(`tenants/${tenantId}/customers`).get();
  const acc: Array<{ email: string; firstName?: string; lastName?: string; attributes?: Record<string, any> }> = [];

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

    if (!email) return;

    const opt =
      c.marketingOptIn === true ||
      c.optIn === true ||
      c.marketing?.optIn === true;

    if (!includeAll && !opt) return;

    const name = (c.name || c.displayName || "").trim();
    const firstName = c.firstName || (name ? splitName(name).firstName : "");
    const lastName = c.lastName || (name ? splitName(name).lastName : "");

    acc.push({
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

  return acc;
}

// 📁 carpeta es [tenant] → params.tenant
type Ctx = { params: { tenant: string } };

export async function POST(req: NextRequest, ctx: Ctx) {
  // 1) Tenant + auth admin scopiado
  const tenantId = requireTenantId(
    resolveTenantFromRequest(req, ctx.params),
    "api:marketing/brevo/sync-all:POST"
  );
  if (req.headers.get("x-debug-auth") === "1") {
    console.log("[SYNC-ALL] tenantId:", tenantId);
  }
  const me = await requireAdmin(req, { tenantId });
  if (!me) {
    return forbiddenDebug(req, { route: "sync-all", tenantId });
  }

  try {
    // 2) Query flags
    const qp = new URL(req.url).searchParams;
    const includeAllFs =
      qp.get("includeFirestoreAll") === "1" || qp.get("includeAll") === "1";

    // 3) Config por tenant (ya no app_config global)
    const db = getAdminDB();
    const cfgSnap = await db.doc(`tenants/${tenantId}/system_flags/marketing`).get();
    const cfg = (cfgSnap.exists ? cfgSnap.data() : null) as { listId?: number | string } | null;
    const listIdNum = cfg?.listId != null ? Number(cfg.listId) : NaN;
    if (!Number.isFinite(listIdNum)) {
      return json({ error: "Missing marketing listId. Run setup first." }, 400);
    }

    // 4) Recolectar contactos: Auth + Customers (tenant)
    const [authContacts, customerContacts] = await Promise.all([
      listAllAuthUsers(),
      listAllCustomers(tenantId, includeAllFs),
    ]);

    // 5) Deduplicación por email (prefiere Auth verificado p/ nombres si faltan)
    const map = new Map<string, { email: string; firstName?: string; lastName?: string; attributes?: Record<string, any> }>();
    for (const c of customerContacts) map.set(c.email, c);
    for (const a of authContacts) {
      const prev = map.get(a.email);
      if (!prev) { map.set(a.email, a); continue; }
      map.set(a.email, {
        email: a.email,
        firstName: a.firstName || prev.firstName || "",
        lastName: a.lastName || prev.lastName || "",
        attributes: { ...(prev.attributes || {}), ...(a.attributes || {}) },
      });
    }

    const contacts = Array.from(map.values());
    if (contacts.length === 0) {
      return json({ ok: true, tenantId, total: 0, created: 0, updated: 0, failed: [], skipped: 0 });
    }

    // 6) Upsert a la lista del tenant en Brevo
    const res = await upsertContacts(contacts, listIdNum);

    // 7) Auditoría por tenant
    try {
      await db.collection(`tenants/${tenantId}/_admin_audit`).add({
        type: "marketing.syncAll",
        provider: "brevo",
        tenantId,
        at: new Date(),
        by: me.uid,
        actorEmail: me.email ?? null,
        includeAllFs,
        sourceCounts: { auth: authContacts.length, customers: customerContacts.length },
        result: { created: res.created, updated: res.updated, failed: (res.failed || []).length },
        origin: "api",
        path: "marketing/brevo/sync-all",
      });
    } catch {
      // no bloquear si el log falla
    }

    return json({
      ok: true,
      tenantId,
      sourceCounts: { auth: authContacts.length, customers: customerContacts.length },
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
        type: "marketing.syncAll.error",
        provider: "brevo",
        tenantId,
        at: new Date(),
        by: me?.uid ?? null,
        error: e?.message ?? String(e),
      });
    } catch {}
    return json({ error: e?.message || "Sync All error" }, 500);
  }
}
