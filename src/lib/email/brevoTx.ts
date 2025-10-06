// src/lib/email/brevoTx.ts
import "server-only";

const API_ROOT = "https://api.brevo.com/v3";

function assertEnv(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`[BrevoTx] Missing env: ${name}`);
  return v;
}

function headers() {
  return {
    accept: "application/json",
    "api-key": assertEnv("BREVO_API_KEY"),
    "content-type": "application/json",
  } as Record<string, string>;
}

export type TxEmailArgs = {
  toEmail: string;
  toName?: string;
  subject: string;
  html: string;
  text?: string;
  senderEmail?: string; // defaults to BREVO_SENDER_EMAIL
  senderName?: string;  // defaults to BREVO_SENDER_NAME or "OrderCraft"
};

export async function sendTransactionalEmail(args: TxEmailArgs) {
  const senderEmail = args.senderEmail || process.env.BREVO_SENDER_EMAIL;
  if (!senderEmail) throw new Error("[BrevoTx] Missing BREVO_SENDER_EMAIL");
  const senderName = args.senderName || process.env.BREVO_SENDER_NAME || "OrderCraft";

  const toEmail = (args.toEmail || "").trim().toLowerCase();
  if (!toEmail || !toEmail.includes("@")) throw new Error("[BrevoTx] invalid toEmail");

  // ✅ Siempre envía un 'name' no vacío
  const toNameCandidate = (args.toName ?? "").toString().trim();
  const fallbackName = toEmail.split("@")[0] || "Customer";
  const toName = toNameCandidate || fallbackName;

  const body = {
    sender: { email: senderEmail, name: senderName },
    to: [{ email: toEmail, name: toName }], // <-- nunca vacío
    subject: args.subject,
    htmlContent: args.html,
    ...(args.text ? { textContent: args.text } : {}),
  };

  const res = await fetch(`${API_ROOT}/smtp/email`, {
    method: "POST",
    headers: headers(),
    body: JSON.stringify(body),
  });

  const text = await res.text().catch(() => "");
  if (!res.ok) {
    throw new Error(`[BrevoTx] send failed: ${res.status} ${text || res.statusText}`);
  }

  let jr: any = {};
  try { jr = text ? JSON.parse(text) : {}; } catch {}
  return { ok: true, messageId: jr?.messageId || null };
}
