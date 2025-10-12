// src/app/(tenant)/[tenant]/app/api/marketing/brevo/contacts/route.ts
export const runtime = "nodejs";

import { NextRequest } from "next/server";

// ✅ Guard / tenancy
import { json, requireAdmin } from "../_guard";
import { resolveTenantFromRequest, requireTenantId } from "@/lib/tenant/server";

// ✅ Firestore Admin para auditoría / config
import { getAdminDB } from "@/lib/firebase/admin";

type BrevoContact = {
  id: number;
  email: string;
  attributes?: Record<string, any>;
  emailBlacklisted?: boolean;
  smsBlacklisted?: boolean;
  createdAt?: string;
  listIds?: number[];
};

function toStringSafe(v: any) {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

// Carpeta es [tenant] → params.tenant
type Ctx = { params: { tenant: string } };

/**
 * GET /api/marketing/brevo/contacts
 * Query:
 *  - q?: string
 *  - status?: 'all' | 'subscribed' | 'unsubscribed' | 'blacklisted'
 *  - listId?: string (si no viene, usa el del tenant en system_flags/marketing.listId)
 *  - limit?: number (1..100, default 50)
 *  - offset?: number (>=0, default 0)
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  // 🔐 tenant + admin
  const tenantId = requireTenantId(
    resolveTenantFromRequest(req, ctx.params),
    "api:marketing/brevo/contacts:GET"
  );
  const me = await requireAdmin(req, { tenantId });
  if (!me) return json({ error: "Forbidden" }, 403);

  try {
    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) return json({ error: "Missing BREVO_API_KEY" }, 500);

    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") || "").trim().toLowerCase();
    const status = (searchParams.get("status") || "all").toLowerCase();
    const listIdFromQuery = (searchParams.get("listId") || "").trim();
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") || 50)));
    const offset = Math.max(0, Number(searchParams.get("offset") || 0));

    // ⚙️ listId: si no viene en query, usa el del tenant
    let effectiveListId = listIdFromQuery;
    if (!effectiveListId) {
      const db = getAdminDB();
      const cfgSnap = await db.doc(`tenants/${tenantId}/system_flags/marketing`).get();
      const cfg = (cfgSnap.exists ? cfgSnap.data() : null) as { listId?: number | string } | null;
      if (!cfg?.listId) return json({ error: "Missing marketing listId. Run setup first." }, 400);
      effectiveListId = String(cfg.listId);
    }

    const base = effectiveListId
      ? `https://api.brevo.com/v3/contacts/lists/${encodeURIComponent(effectiveListId)}/contacts`
      : `https://api.brevo.com/v3/contacts`;

    const url = new URL(base);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));
    url.searchParams.set("sort", "desc");

    const res = await fetch(url.toString(), {
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "api-key": apiKey,
      },
      method: "GET",
    });

    if (!res.ok) {
      const jr = await res.json().catch(() => ({}));
      return json({ error: jr?.message || `Brevo error (${res.status})` }, 502);
    }

    const data = await res.json();
    const raw: BrevoContact[] = data?.contacts || data?.results || [];

    // Normaliza y filtra en server
    const normalized = raw.map((c) => {
      const firstName =
        c?.attributes?.FIRSTNAME ??
        c?.attributes?.FirstName ??
        c?.attributes?.firstName ??
        "";
      const lastName =
        c?.attributes?.LASTNAME ??
        c?.attributes?.LastName ??
        c?.attributes?.lastName ??
        "";
      const name = [firstName, lastName].filter(Boolean).join(" ").trim();

      const computedStatus = c.emailBlacklisted ? "unsubscribed" : "subscribed";

      return {
        id: c.id,
        email: c.email,
        name,
        firstName,
        lastName,
        createdAt: c.createdAt || null,
        listIds: Array.isArray(c.listIds) ? c.listIds : [],
        emailBlacklisted: !!c.emailBlacklisted,
        smsBlacklisted: !!c.smsBlacklisted,
        status: computedStatus,
      };
    });

    const filtered = normalized.filter((c) => {
      const matchesQ =
        !q ||
        toStringSafe(c.email).toLowerCase().includes(q) ||
        toStringSafe(c.name).toLowerCase().includes(q);

      const matchesStatus =
        status === "all" ||
        (status === "subscribed" && c.status === "subscribed") ||
        (status === "unsubscribed" && c.status === "unsubscribed") ||
        (status === "blacklisted" && c.emailBlacklisted === true);

      return matchesQ && matchesStatus;
    });

    // 🧾 (opcional) auditoría de lectura — poco ruidosa, solo metadatos
    try {
      const db = getAdminDB();
      await db.collection(`tenants/${tenantId}/_admin_audit`).add({
        type: "contacts.list",
        provider: "brevo",
        tenantId,
        at: new Date(),
        by: me.uid,
        q: q || null,
        status,
        listId: effectiveListId,
        page: { limit, offset, returned: filtered.length },
        origin: "api",
        path: "marketing/brevo/contacts",
      });
    } catch {
      // no-op
    }

    return json({
      ok: true,
      tenantId,
      items: filtered,
      page: { limit, offset, returned: filtered.length },
      brevo: { nextOffset: offset + limit },
    });
  } catch (e: any) {
    return json({ error: e?.message || "Server error" }, 500);
  }
}
