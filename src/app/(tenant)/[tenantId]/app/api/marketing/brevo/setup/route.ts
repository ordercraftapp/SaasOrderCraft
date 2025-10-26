export const runtime = "nodejs";

import { NextRequest } from "next/server";

// ✅ helpers del guard local
import { json, requireAdmin } from "../_guard";

// ✅ tenancy helpers
import { resolveTenantFromRequest, requireTenantId } from "@/lib/tenant/server";

// ✅ Firestore Admin
import { getAdminDB } from "@/lib/firebase/admin";

// ✅ lógica existente
import { ensureFolderAndList } from "@/lib/marketing/brevo";

// La carpeta es [tenant] → params.tenant
type Ctx = { params: { tenant: string } };

export async function POST(req: NextRequest, ctx: Ctx) {
  // 1) Resolver tenantId y validar admin del tenant
  const tenantId = requireTenantId(
    resolveTenantFromRequest(req, ctx.params),
    "api:marketing/brevo/setup:POST"
  );
  const me = await requireAdmin(req, { tenantId });
  if (!me) return json({ error: "Forbidden" }, 403);

  try {
    // 2) Crear/asegurar carpeta y lista en Brevo — scopiadas por tenant
    //    Nombres con prefijo por tenant para evitar colisiones y mezclar datos.
    const folderName = `OC:${tenantId}`;
    const listName = `OC:${tenantId}:Customers`;

    const conf = await ensureFolderAndList({ folderName, listName }); // { folderId, listId, folderName, listName }

    // 3) Guardar config scopiada al tenant
    const db = getAdminDB();
    await db.doc(`tenants/${tenantId}/system_flags/marketing`).set(
      {
        provider: "brevo",
        ...conf,              // folderId, listId, folderName, listName
        tenantId,             // siempre incluir tenantId en el documento
        // (opcional) Defaults del remitente a nivel tenant (puedes editarlos luego)
        senderName: process.env.BREVO_SENDER_NAME || "OrderCraft",
        senderEmail: process.env.BREVO_SENDER_EMAIL || null,
        updatedAt: new Date(),
        updatedBy: me.uid ?? null,
        updatedByEmail: me.email ?? null,
      },
      { merge: true }
    );

    // 4) Auditoría por tenant
    await db.collection(`tenants/${tenantId}/_admin_audit`).add({
      type: "marketing.setup",
      provider: "brevo",
      tenantId,
      at: new Date(),
      by: me.uid,
      actorEmail: me.email ?? null,
      configKeys: Object.keys(conf),
      origin: "api",
      path: "marketing/brevo/setup",
    });

    return json({ ok: true, tenantId, config: conf });
  } catch (e: any) {
    // intento de log del error sin bloquear la respuesta
    try {
      const db = getAdminDB();
      await db.collection(`tenants/${tenantId}/_admin_audit`).add({
        type: "marketing.setup.error",
        provider: "brevo",
        tenantId,
        at: new Date(),
        by: me?.uid ?? null,
        error: e?.message ?? String(e),
      });
    } catch {}
    return json({ error: e?.message || "Setup error" }, 500);
  }
}
