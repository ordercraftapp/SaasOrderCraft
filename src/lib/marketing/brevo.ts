// src/lib/marketing/brevo.ts
import "server-only";

const API_ROOT = "https://api.brevo.com/v3";

function assertEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`[Brevo] Missing env: ${name}`);
  return v;
}

function headers() {
  return {
    accept: "application/json",
    "api-key": assertEnv("BREVO_API_KEY"),
    "content-type": "application/json",
  } as Record<string, string>;
}

async function readTextSafe(res: Response) {
  try {
    return await res.text();
  } catch {
    return "";
  }
}

/** -------------------------
 *  Carpetas y Listas (Setup)
 *  ------------------------*/
export async function ensureFolderAndList(opts?: { folderName?: string; listName?: string }) {
  const folderName = opts?.folderName || "OrderCraft";
  const listName = opts?.listName || "OrderCraft Customers";

  // 1) Buscar / crear Folder
  const foldersRes = await fetch(`${API_ROOT}/contacts/folders?limit=50&offset=0`, {
    method: "GET",
    headers: headers(),
    cache: "no-store" as any,
  });
  if (!foldersRes.ok) throw new Error(`[Brevo] folders list failed: ${foldersRes.status} ${await readTextSafe(foldersRes)}`);
  const foldersData = await foldersRes.json().catch(() => ({}));
  let folder = (foldersData.folders || []).find((f: any) => f?.name === folderName);
  if (!folder) {
    const createFolder = await fetch(`${API_ROOT}/contacts/folders`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ name: folderName }),
    });
    if (!createFolder.ok) throw new Error(`[Brevo] create folder failed: ${createFolder.status} ${await readTextSafe(createFolder)}`);
    folder = await createFolder.json().catch(() => ({}));
  }

  // 2) Buscar / crear List
  const listsRes = await fetch(`${API_ROOT}/contacts/lists?limit=50&offset=0`, {
    method: "GET",
    headers: headers(),
  });
  if (!listsRes.ok) throw new Error(`[Brevo] lists list failed: ${listsRes.status} ${await readTextSafe(listsRes)}`);
  const listsData = await listsRes.json().catch(() => ({}));
  let list = (listsData.lists || []).find((l: any) => l?.name === listName);
  if (!list) {
    const createList = await fetch(`${API_ROOT}/contacts/lists`, {
      method: "POST",
      headers: headers(),
      body: JSON.stringify({ name: listName, folderId: folder.id }),
    });
    if (!createList.ok) throw new Error(`[Brevo] create list failed: ${createList.status} ${await readTextSafe(createList)}`);
    list = await createList.json().catch(() => ({}));
  }

  return { folderId: folder.id, listId: list.id, folderName, listName };
}

/** --------------------------------
 *  Upsert de contactos hacia Brevo
 *  - Crea (201) o actualiza (204)
 *  --------------------------------*/
export async function upsertContacts(
  contacts: Array<{ email: string; firstName?: string; lastName?: string; attributes?: Record<string, any> }>,
  listId: number
) {
  let created = 0;
  let updated = 0;
  const failed: Array<{ email: string; error: string }> = [];

  for (const c of contacts) {
    try {
      const body: any = {
        email: c.email,
        updateEnabled: true,
        listIds: [listId],
        attributes: {
          FIRSTNAME: c.firstName || undefined,
          LASTNAME: c.lastName || undefined,
          ...(c.attributes || {}),
        },
      };

      const res = await fetch(`${API_ROOT}/contacts`, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const txt = await readTextSafe(res);
        failed.push({ email: c.email, error: `${res.status} ${txt || res.statusText}` });
        continue;
      }

      // Éxito:
      // - 201 Created -> devuelve JSON con { id }
      // - 204 No Content -> actualizado sin cuerpo
      if (res.status === 201) {
        const jr = await res.json().catch(() => null);
        if (jr && typeof jr.id !== "undefined") created += 1;
        else updated += 1; // fallback si no vino id por alguna razón
      } else if (res.status === 204) {
        updated += 1;
      } else {
        // Otros 2xx (poco comunes aquí): considéralo actualizado
        updated += 1;
      }
    } catch (e: any) {
      failed.push({ email: c.email, error: e?.message || "unknown" });
    }
  }

  return { created, updated, failed };
}

/** ------------------
 *  Campañas (Email)
 *  -----------------*/
export async function createCampaign(args: {
  subject: string;
  htmlContent: string;
  listId: number;
  senderName?: string;
  senderEmail?: string;
}) {
  const senderName = args.senderName || process.env.BREVO_SENDER_NAME || "OrderCraft";
  const senderEmail = args.senderEmail || process.env.BREVO_SENDER_EMAIL;
  if (!senderEmail) throw new Error("[Brevo] Missing env: BREVO_SENDER_EMAIL");

  const body = {
    name: args.subject,
    subject: args.subject,
    htmlContent: args.htmlContent,
    sender: { name: senderName, email: senderEmail },
    recipients: { listIds: [args.listId] },
    type: "classic",
    inlineImageActivation: true,
  };

  const res = await fetch(`${API_ROOT}/emailCampaigns`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`[Brevo] createCampaign failed: ${res.status} ${await readTextSafe(res)}`);
  return await res.json();
}

export async function sendCampaignNow(id: number) {
  const res = await fetch(`${API_ROOT}/emailCampaigns/${id}/sendNow`, {
    method: "POST",
    headers: headers(),
  });
  if (!res.ok) throw new Error(`[Brevo] sendNow failed: ${res.status} ${await readTextSafe(res)}`);
  return { ok: true };
}

export async function sendCampaignTest(id: number, emails: string[]) {
  const res = await fetch(`${API_ROOT}/emailCampaigns/${id}/sendTest`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify({ emailTo: emails }),
  });
  if (!res.ok) throw new Error(`[Brevo] sendTest failed: ${res.status} ${await readTextSafe(res)}`);
  return { ok: true };
}

export async function listCampaigns(limit = 20, offset = 0) {
  const res = await fetch(`${API_ROOT}/emailCampaigns?limit=${limit}&offset=${offset}`, {
    method: "GET",
    headers: headers(),
  });
  if (!res.ok) throw new Error(`[Brevo] listCampaigns failed: ${res.status} ${await readTextSafe(res)}`);
  return await res.json();
}
