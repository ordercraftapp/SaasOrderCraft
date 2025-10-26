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
  unsubscribeDate?: string | null;
};

function toStringSafe(v: any) {
  return typeof v === "string" ? v : v == null ? "" : String(v);
}

function assertEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`[Brevo] Missing env: ${name}`);
  return v;
}

function brevoHeaders() {
  return {
    accept: "application/json",
    "content-type": "application/json",
    "api-key": assertEnv("BREVO_API_KEY"),
  } as Record<string, string>;
}

// Carpeta es [tenant] → params.tenant
type Ctx = { params: { tenant: string } };

/**
 * GET /api/marketing/brevo/contacts
 * Query:
 *  - q?: string       (alias: search)
 *  - status?: 'all' | 'subscribed' | 'unsubscribed' | 'blacklisted'
 *  - listId?: string  (si no viene, usa el del tenant en system_flags/marketing.listId)
 *  - limit?: number   (1..100, default 50)
 *  - offset?: number  (>=0,  default 0)
 *
 * Comportamiento:
 *  - Llama a Brevo /contacts/lists/{listId}/contacts para aislar por tenant.
 *  - Filtra en servidor por q/status (porque el endpoint de Brevo no tiene "search" nativo).
 *  - Mantiene el shape de respuesta que tu UI ya consume.
 */
export async function GET(req: NextRequest, ctx: Ctx) {
  // 🔐 tenant + admin/owner/superadmin/marketing
  const tenantId = requireTenantId(
    resolveTenantFromRequest(req, ctx.params),
    "api:marketing/brevo/contacts:GET"
  );
  const me = await requireAdmin(req, {
    tenantId,
    roles: ["admin", "owner", "superadmin", "marketing"],
  });
  if (!me) return json({ error: "Forbidden" }, 403);

  try {
    const { searchParams } = new URL(req.url);
    // alias: search → q (retrocompat con tu UI que usa "q")
    const qRaw = (searchParams.get("q") || searchParams.get("search") || "").trim();
    const q = qRaw.toLowerCase();
    const status = (searchParams.get("status") || "all").toLowerCase();
    const listIdFromQuery = (searchParams.get("listId") || "").trim();
    const limit = Math.min(100, Math.max(1, Number(searchParams.get("limit") || 50)));
    const offset = Math.max(0, Number(searchParams.get("offset") || 0));

    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) return json({ error: "Missing BREVO_API_KEY" }, 500);

    // ⚙️ listId: si no viene en query, usa el del tenant
    let effectiveListId = listIdFromQuery;
    if (!effectiveListId) {
      const db = getAdminDB();
      const cfgSnap = await db.doc(`tenants/${tenantId}/system_flags/marketing`).get();
      const cfg = (cfgSnap.exists ? cfgSnap.data() : null) as { listId?: number | string } | null;
      if (!cfg?.listId) return json({ error: "Missing marketing listId. Run setup first." }, 400);
      effectiveListId = String(cfg.listId);
    }

    // Endpoint de lista para aislar por tenant
    const base = `https://api.brevo.com/v3/contacts/lists/${encodeURIComponent(effectiveListId)}/contacts`;
    const url = new URL(base);
    url.searchParams.set("limit", String(limit));
    url.searchParams.set("offset", String(offset));
    // Brevo puede ignorar 'sort' aquí; lo dejamos por si acaso (no rompe)
    url.searchParams.set("sort", "desc");

    const res = await fetch(url.toString(), {
      headers: brevoHeaders(),
      method: "GET",
    });

    if (!res.ok) {
      // best-effort para ampliar error
      let errText = "";
      try { errText = await res.text(); } catch {}
      return json({ error: `[Brevo] list contacts failed: ${res.status} ${errText || res.statusText}` }, 502);
    }

    const data = await res.json().catch(() => ({} as any));
    const raw: BrevoContact[] = Array.isArray(data?.contacts)
      ? data.contacts
      : Array.isArray(data?.results)
      ? data.results
      : [];

    // Normaliza y filtra en server
    const normalized = raw.map((c) => {
      const firstName =
        c?.attributes?.FIRSTNAME ??
        (c?.attributes as any)?.FirstName ??
        (c?.attributes as any)?.firstName ??
        "";
      const lastName =
        c?.attributes?.LASTNAME ??
        (c?.attributes as any)?.LastName ??
        (c?.attributes as any)?.lastName ??
        "";

      // Estado más preciso:
      // - blacklisted => "blacklisted"
      // - si no es blacklisted pero tiene unsubscribeDate => "unsubscribed"
      // - en otro caso => "subscribed"
      let computedStatus: "blacklisted" | "unsubscribed" | "subscribed" = "subscribed";
      if (c.emailBlacklisted) computedStatus = "blacklisted";
      else if ((c as any)?.unsubscribeDate) computedStatus = "unsubscribed";

      return {
        id: c.id,
        email: c.email,
        name: [firstName, lastName].filter(Boolean).join(" ").trim(),
        firstName,
        lastName,
        createdAt: c.createdAt || null,
        listIds: Array.isArray(c.listIds) ? c.listIds : [],
        emailBlacklisted: !!c.emailBlacklisted,
        smsBlacklisted: !!c.smsBlacklisted,
        status: computedStatus,
        // por si en el futuro quieres exponer atributos/tags
        // attributes: c.attributes ?? {},
      };
    });

    const filtered = normalized.filter((c) => {
      const matchesQ =
        !q ||
        toStringSafe(c.email).toLowerCase().includes(q) ||
        toStringSafe(c.name).toLowerCase().includes(q) ||
        toStringSafe(c.firstName).toLowerCase().includes(q) ||
        toStringSafe(c.lastName).toLowerCase().includes(q);

      const matchesStatus =
        status === "all" ||
        (status === "subscribed" && c.status === "subscribed") ||
        (status === "unsubscribed" && c.status === "unsubscribed") ||
        (status === "blacklisted" && c.status === "blacklisted");

      return matchesQ && matchesStatus;
    });

    // Brevo a veces retorna count; si no, hacemos best-effort con offset+returned
    const total =
      typeof (data as any)?.count === "number"
        ? (data as any).count
        : offset + filtered.length;

    // 🧾 (opcional) auditoría de lectura — poco ruidosa, solo metadatos
    try {
      const db = getAdminDB();
      await db.collection(`tenants/${tenantId}/_admin_audit`).add({
        type: "contacts.list",
        provider: "brevo",
        tenantId,
        at: new Date(),
        by: me.uid,
        q: qRaw || null,
        status,
        listId: effectiveListId,
        page: { limit, offset, returned: filtered.length, total },
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
      total,
      brevo: { nextOffset: offset + limit },
    });
  } catch (e: any) {
    return json({ error: e?.message || "Server error" }, 500);
  }
}
