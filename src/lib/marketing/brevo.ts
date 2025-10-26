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

/* ---------------------------
   Utilidades para campañas
----------------------------*/

const SAFE_PIXEL = "https://placehold.co/1x1";

/** Normaliza hosts problemáticos y fuerza https donde aplique. */
function normalizeUrl(u: string): string {
  if (!u) return u;
  let out = u.trim();

  // via.placeholder.com → placehold.co (más estable)
  out = out.replace(/^https?:\/\/via\.placeholder\.com/gi, "https://placehold.co");

  // Forzar https si venía http (solo dominios normales; no data:, cid:)
  if (/^http:\/\//i.test(out)) {
    out = out.replace(/^http:\/\//i, "https://");
  }

  return out;
}

/** Limpia el HTML de fuentes que Brevo rechaza cuando valida attachments.
 *  - Convierte http→https en src, srcset, href y url(...)
 *  - Reemplaza via.placeholder.com
 *  - Sustituye data:/cid: por un pixel remoto seguro (placehold.co)
 */
function sanitizeHtmlForBrevo(html: string): string {
  if (!html) return html;

  let out = html;

  // 1) src="..."
  out = out.replace(
    /(\bsrc\s*=\s*['"])([^'"]+)(['"])/gi,
    (_m, p1, url, p3) => {
      let v = String(url || "").trim();
      if (/^(data:|cid:)/i.test(v)) return `${p1}${SAFE_PIXEL}${p3}`;
      v = normalizeUrl(v);
      return `${p1}${v}${p3}`;
    }
  );

  // 2) srcset="a 1x, b 2x, ..."
  out = out.replace(
    /(\bsrcset\s*=\s*['"])([^'"]+)(['"])/gi,
    (_m, p1, list, p3) => {
      const items = String(list || "")
        .split(",")
        .map(s => s.trim())
        .map(entry => {
          // Cada entry = "<url> [descriptor]"
          const parts = entry.split(/\s+/);
          if (parts.length === 0) return entry;
          let url = parts[0];
          if (/^(data:|cid:)/i.test(url)) {
            parts[0] = SAFE_PIXEL;
          } else {
            parts[0] = normalizeUrl(url);
          }
          return parts.join(" ");
        });
      return `${p1}${items.join(", ")}${p3}`;
    }
  );

  // 3) href="..." (por si hubiera enlaces http a imágenes o tracking)
  out = out.replace(
    /(\bhref\s*=\s*['"])([^'"]+)(['"])/gi,
    (_m, p1, url, p3) => {
      const v = normalizeUrl(String(url || "").trim());
      return `${p1}${v}${p3}`;
    }
  );

  // 4) url(...) en estilos inline
  out = out.replace(
    /(url\(\s*['"]?)([^'")]+)(['"]?\s*\))/gi,
    (_m, p1, url, p3) => {
      let v = String(url || "").trim();
      if (/^(data:|cid:)/i.test(v)) v = SAFE_PIXEL;
      v = normalizeUrl(v);
      return `${p1}${v}${p3}`;
    }
  );

  return out;
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

      if (res.status === 201) {
        const jr = await res.json().catch(() => null);
        if (jr && typeof jr.id !== "undefined") created += 1;
        else updated += 1;
      } else if (res.status === 204) {
        updated += 1;
      } else {
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

  // Sanitiza HTML para evitar "Invalid attachment url"
  const cleanedHtml = sanitizeHtmlForBrevo(args.htmlContent);

  const body: any = {
    name: args.subject,
    subject: args.subject,
    htmlContent: cleanedHtml,
    sender: { name: senderName, email: senderEmail },
    recipients: { listIds: [args.listId] },
    type: "classic",
    // Evita que Brevo adjunte/valide URLs de imágenes del HTML.
    inlineImageActivation: false,
  };

  // Limpieza: evita enviar null/undefined
  for (const k of Object.keys(body)) {
    if (body[k] === undefined || body[k] === null) delete body[k];
  }

  const res = await fetch(`${API_ROOT}/emailCampaigns`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const txt = await readTextSafe(res);
    throw new Error(`[Brevo] createCampaign failed: ${res.status} ${txt}`);
  }

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
