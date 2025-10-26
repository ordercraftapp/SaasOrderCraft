// src/app/(tenant)/[tenant]/app/api/marketing/brevo/setup/route.ts
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

  const db = getAdminDB();
  const docRef = db.doc(`tenants/${tenantId}/system_flags/marketing`);

  try {
    // ⚙️ Lee config existente para mantener compatibilidad (no pisar createdAt/senders/etc.)
    const prevSnap = await docRef.get();
    const prev = (prevSnap.exists ? prevSnap.data() : null) as
      | {
          provider?: string;
          folderId?: number | string | null;
          listId?: number | string | null;
          newsletterListId?: number | string | null; // legado
          folderName?: string | null;
          listName?: string | null;
          senderName?: string | null;
          senderEmail?: string | null;
          maxCampaignsPerMonth?: number | null;
          createdAt?: Date | null;
        }
      | null;

    // 2) Crear/asegurar carpeta y lista en Brevo — scopiadas por tenant
    //    Nombres con prefijo por tenant para evitar colisiones y mezclar datos.
    const folderName = prev?.folderName || `OC:${tenantId}`;
    const listName = prev?.listName || `OC:${tenantId}:Customers`;

    // Idempotente: la función existente ya crea/usa si existen
    const conf = await ensureFolderAndList({ folderName, listName }); // { folderId, listId, folderName, listName }

    // 🔢 Normaliza IDs a número (si vienen como string)
    const toNum = (v: unknown): number | null =>
      typeof v === "number"
        ? v
        : typeof v === "string" && /^\d+$/.test(v)
        ? Number(v)
        : null;

    const folderId = toNum((conf as any).folderId ?? prev?.folderId) as number | null;
    const listId = toNum((conf as any).listId ?? prev?.listId) as number | null;

    if (!folderId || !listId) {
      throw new Error("Invalid Brevo folder/list IDs.");
    }

    // 3) Construir payload a guardar (retro-compatible)
    const now = new Date();

    const nextPayload = {
      provider: "brevo",
      tenantId,

      // IDs y nombres (fuente de verdad)
      folderId,
      listId,
      folderName: (conf as any).folderName || folderName,
      listName: (conf as any).listName || listName,

      // 📨 remitente por tenant (preserva existentes, cae a env si no hay)
      senderName:
        prev?.senderName ??
        process.env.BREVO_SENDER_NAME ??
        "OrderCraft",
      senderEmail:
        prev?.senderEmail ??
        process.env.BREVO_SENDER_EMAIL ??
        null,

      // 🕰️ tiempos (no pisar createdAt si ya existe)
      createdAt: prev?.createdAt ?? now,
      updatedAt: now,

      // 👤 auditoría mínima embebida
      updatedBy: me.uid ?? null,
      updatedByEmail: (me as any)?.email ?? null,

      // ⚠️ compatibilidad LEGADO: mantener newsletterListId en espejo
      newsletterListId:
        toNum(prev?.newsletterListId ?? listId) ?? listId,

      // 📊 respeta maxCampaignsPerMonth previo si existía
      ...(prev?.maxCampaignsPerMonth != null
        ? { maxCampaignsPerMonth: prev.maxCampaignsPerMonth }
        : {}),
    };

    // 4) Guardar config scopiada al tenant
    await docRef.set(nextPayload, { merge: true });

    // 5) Auditoría por tenant
    await db.collection(`tenants/${tenantId}/_admin_audit`).add({
      type: "marketing.setup",
      provider: "brevo",
      tenantId,
      at: now,
      by: me.uid,
      actorEmail: (me as any)?.email ?? null,
      configKeys: Object.keys({
        folderId,
        listId,
        folderName: nextPayload.folderName,
        listName: nextPayload.listName,
        senderName: nextPayload.senderName,
        senderEmail: nextPayload.senderEmail,
        newsletterListId: nextPayload.newsletterListId,
      }),
      origin: "api",
      path: "marketing/brevo/setup",
    });

    // Respuesta retro-compatible
    return json({
      ok: true,
      tenantId,
      config: {
        folderId,
        listId,
        folderName: nextPayload.folderName,
        listName: nextPayload.listName,
      },
    });
  } catch (e: any) {
    // intento de log del error sin bloquear la respuesta
    try {
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
