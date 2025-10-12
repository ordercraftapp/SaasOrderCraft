// src/app/(tenant)/[tenant]/app/api/newsletter/subscribe/route.ts
export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getAdminDB } from "@/lib/firebase/admin";
import { resolveTenantFromRequest, requireTenantId } from "@/lib/tenant/server";

function isValidEmail(e?: string) {
  return !!e && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
}

// 📁 carpeta es [tenant] → params.tenant
type Ctx = { params: { tenant: string } };

export async function POST(req: NextRequest, ctx: Ctx) {
  try {
    const { email } = await req.json().catch(() => ({} as any));
    if (!isValidEmail(email)) {
      return NextResponse.json({ ok: false, error: "invalid_email" }, { status: 400 });
    }

    // 🔐 tenant
    const tenantId = requireTenantId(
      resolveTenantFromRequest(req, ctx.params),
      "api:newsletter/subscribe:POST"
    );

    const apiKey = process.env.BREVO_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ ok: false, error: "missing_api_key" }, { status: 500 });
    }

    // 🧩 listId: primero intenta config del tenant; si no, usa env fallback (compat)
    let listId: number | null = null;
    try {
      const db = getAdminDB();
      const cfgSnap = await db.doc(`tenants/${tenantId}/system_flags/marketing`).get();
      const cfg = (cfgSnap.exists ? cfgSnap.data() : null) as { listId?: number | string; newsletterListId?: number | string } | null;
      const candidate = cfg?.newsletterListId ?? cfg?.listId;
      if (candidate != null && String(candidate).match(/^\d+$/)) {
        listId = Number(candidate);
      } else if (process.env.BREVO_NEWSLETTER_LIST_ID && /^\d+$/.test(process.env.BREVO_NEWSLETTER_LIST_ID)) {
        listId = Number(process.env.BREVO_NEWSLETTER_LIST_ID);
      }
    } catch {
      // si falla leer config, todavía podemos intentar con env
      if (process.env.BREVO_NEWSLETTER_LIST_ID && /^\d+$/.test(process.env.BREVO_NEWSLETTER_LIST_ID)) {
        listId = Number(process.env.BREVO_NEWSLETTER_LIST_ID);
      }
    }

    // 📤 Payload a Brevo
    const payload: Record<string, any> = {
      email,
      updateEnabled: true, // evita conflicto si ya existe
      attributes: {
        TENANT: tenantId,
        SOURCE: "newsletter_subscribe",
        SUBSCRIBED_AT: new Date().toISOString(),
      },
    };
    if (typeof listId === "number") {
      payload.listIds = [listId];
    }

    // Brevo: https://api.brevo.com/v3/contacts
    const r = await fetch("https://api.brevo.com/v3/contacts", {
      method: "POST",
      headers: {
        "api-key": apiKey,
        "content-type": "application/json",
        accept: "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (r.ok) {
      // 🧾 auditoría best-effort
      (async () => {
        try {
          const db = getAdminDB();
          await db.collection(`tenants/${tenantId}/_admin_audit`).add({
            type: "newsletter.subscribe",
            provider: "brevo",
            tenantId,
            email,
            listId: listId ?? null,
            at: new Date(),
            origin: "api",
            path: "newsletter/subscribe",
          });
        } catch {}
      })();

      return NextResponse.json({ ok: true, tenantId });
    } else {
      const txt = await r.text().catch(() => "");
      return NextResponse.json({ ok: false, error: "brevo_error", detail: txt }, { status: 502 });
    }
  } catch {
    return NextResponse.json({ ok: false, error: "unexpected" }, { status: 500 });
  }
}
