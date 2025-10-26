export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getAdminDB } from "@/lib/firebase/admin";
import { resolveTenantFromRequest, requireTenantId } from "@/lib/tenant/server";

type Ctx = { params: { tenant: string } };

function isValidEmail(e?: string) {
  return !!e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

function json(d: unknown, s = 200) {
  return NextResponse.json(d, { status: s });
}

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { email } = (await req.json().catch(() => ({}))) as { email?: string };

    if (!isValidEmail(email)) {
      return json({ ok: false, error: "invalid_email" }, 400);
    }

    // 🔐 tenant resuelto del path/host (el body puede traerlo pero no se confía en él)
    const tenantId = requireTenantId(
      resolveTenantFromRequest(req, ctx.params),
      "api:newsletter/subscribe:POST"
    );

    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) {
      return json({ ok: false, error: "missing_api_key" }, 500);
    }

    const db = getAdminDB();

    // 🔧 Config única de marketing (fuente de verdad)
    const cfgSnap = await db.doc(`tenants/${tenantId}/system_flags/marketing`).get();
    const cfg = (cfgSnap.exists ? cfgSnap.data() : null) as
      | { listId?: number | string; folderId?: number | string }
      | null;

    const listIdRaw = cfg?.listId;
    const listId =
      typeof listIdRaw === "number"
        ? listIdRaw
        : typeof listIdRaw === "string" && /^\d+$/.test(listIdRaw)
        ? Number(listIdRaw)
        : null;

    if (!listId) {
      // ⚠️ La lista no está configurada: el setup debe crearla y guardar listId
      return json({ ok: false, error: "list_not_configured" }, 503);
    }

    // 📤 Brevo — upsert contacto en la lista del tenant
    const payload = {
      email,
      updateEnabled: true,
      listIds: [listId],
      attributes: {
        TENANT_ID: tenantId,
        SOURCE: "newsletter_subscribe",
        SUBSCRIBED_AT: new Date().toISOString(),
      },
    };

    const r = await fetch("https://api.brevo.com/v3/contacts", {
      method: "POST",
      headers: {
        "api-key": apiKey,
        accept: "application/json",
        "content-type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!r.ok) {
      const detail = await r.text().catch(() => "");
      return json({ ok: false, error: "brevo_error", detail }, 502);
    }

    // 🧾 Persistencia local (idempotente)
    const emailLower = String(email).toLowerCase();
    await db
      .doc(`tenants/${tenantId}/newsletter_signups/${emailLower}`)
      .set(
        {
          email: emailLower,
          tenantId,
          source: "newsletter_subscribe",
          provider: "brevo",
          listId,
          updatedAt: new Date(),
          createdAt: new Date(),
        },
        { merge: true }
      );

    // 🔍 Auditoría best-effort (no bloqueante)
    db.collection(`tenants/${tenantId}/_admin_audit`)
      .add({
        type: "newsletter.subscribe",
        provider: "brevo",
        tenantId,
        email: emailLower,
        listId,
        at: new Date(),
        origin: "api",
        path: "newsletter/subscribe",
      })
      .catch(() => {});

    return json({ ok: true, tenantId }, 200);
  } catch (e: any) {
    return json({ ok: false, error: "unexpected", detail: String(e?.message || e) }, 500);
  }
}
