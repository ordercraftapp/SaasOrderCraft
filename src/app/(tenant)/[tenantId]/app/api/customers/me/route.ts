export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { getUserFromRequest } from "@/lib/server/auth";
import { sendTransactionalEmail } from "@/lib/email/brevoTx";
import { FieldValue } from "firebase-admin/firestore";

import { resolveTenantFromRequest, requireTenantId } from "@/lib/tenant/server";
import { tColAdmin } from "@/lib/db_admin";

const json = (d: unknown, s = 200) => NextResponse.json(d, { status: s });

const SITE_URL = "https://ordercraft.datacraftcoders.com";

function welcomeHtml(name?: string | null) {
  const safe = (name || "").trim();
  const greeting = `Welcome${safe ? `, ${safe}` : ""}!`;
  return `
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#fff;opacity:0;">
    ${greeting} Use code WELCOME5 for Q5 off your first order at OrderCraft.
  </div>
  <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:#f6f8fb;padding:24px 0;">
    <tr>
      <td align="center">
        <table role="presentation" cellpadding="0" cellspacing="0" width="600" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 2px 10px rgba(17,24,39,.06);">
          <tr>
            <td style="background:#111827;color:#ffffff;padding:16px 24px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;letter-spacing:.2px;">
              OrderCraft
            </td>
          </tr>
          <tr>
            <td style="padding:28px 24px 8px 24px;font-family:Arial,Helvetica,sans-serif;">
              <h1 style="margin:0 0 8px 0;font-size:24px;line-height:1.3;color:#111827;">${greeting} 🎉</h1>
              <p style="margin:0 0 14px 0;font-size:15px;line-height:1.6;color:#374151;">
                Thanks for creating your account at OrderCraft. You can now order your favorite dishes and track delivery in real time.
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:0 24px 8px 24px;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;">
                <tr>
                  <td style="padding:16px 18px;font-family:Arial,Helvetica,sans-serif;">
                    <p style="margin:0 0 6px 0;font-size:14px;letter-spacing:.08em;color:#166534;text-transform:uppercase;font-weight:700;">Welcome gift</p>
                    <p style="margin:0 0 10px 0;font-size:16px;color:#065f46;"><strong>Use code <span style="letter-spacing:.08em;">WELCOME5</span> for <span style="white-space:nowrap;">Q5 off</span> your first order</strong></p>
                    <p style="margin:0;font-size:12px;color:#065f46;opacity:.85;">Valid for your first purchase. One use per account.</p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 24px 4px 24px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="border-radius:10px;background:#16a34a;">
                    <a href="${SITE_URL}" target="_blank" rel="noopener noreferrer"
                       style="display:inline-block;padding:12px 18px;color:#ffffff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;">
                      Start ordering
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:10px 0 0 0;font-size:12px;color:#6b7280;font-family:Arial,Helvetica,sans-serif;">
                Or paste this link into your browser: <a href="${SITE_URL}" style="color:#2563eb;text-decoration:underline;">${SITE_URL.replace(/^https?:\/\//, "")}</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 24px 8px 24px;font-family:Arial,Helvetica,sans-serif;">
              <ul style="margin:0 0 8px 22px;padding:0;color:#374151;font-size:14px;line-height:1.7;">
                <li>Fast local delivery</li>
                <li>Live order tracking</li>
                <li>Fresh & tasty menu, always</li>
              </ul>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 24px 24px 24px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#6b7280;">
              <p style="margin:0 0 6px 0;">If you have any questions, just reply to this email — we’re happy to help.</p>
              <p style="margin:0;color:#9ca3af;">© ${new Date().getFullYear()} OrderCraft</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>`;
}

function welcomeText(name?: string | null) {
  const safe = (name || "").trim();
  const greeting = `Welcome${safe ? `, ${safe}` : ""}!`;
  return `${greeting}

Thanks for creating your account at OrderCraft. You can now order your favorite dishes and track delivery in real time.

Use code WELCOME5 for Q5 off your first order.
Start here: ${SITE_URL}

If you have any questions, just reply to this email.`;
}

export async function POST(req: NextRequest, ctx: { params: { tenant: string } }) {
  try {
    const user = await getUserFromRequest(req);
    if (!user) return json({ error: "Unauthorized" }, 401);

    const tenantId = requireTenantId(
      resolveTenantFromRequest(req, ctx?.params),
      "api:/tx/welcome"
    );

    const uid = user.uid;
    const ref = tColAdmin("customers", tenantId).doc(uid);

    const snap = await ref.get();
    if (!snap.exists) {
      // Si no hay membresía en este tenant, no enviamos welcome.
      return json({ ok: false, notFound: true }, 404);
    }

    const data = snap.data() || {};
    if (data?.tx?.welcomeSentAt) {
      return json({ ok: true, skipped: true });
    }

    const toEmail = (data.email || user.email || "").toString().trim().toLowerCase();
    if (!toEmail || !toEmail.includes("@")) {
      return json({ error: "No valid email to send welcome message." }, 400);
    }

    const displayName =
      data.displayName || (user as any)?.name || (user as any)?.displayName || null;

    const { messageId } = await sendTransactionalEmail({
      toEmail,
      toName: displayName || "",
      subject: "Welcome to OrderCraft",
      html: welcomeHtml(displayName),
      text: welcomeText(displayName),
    });

    await ref.set(
      {
        tenantId,
        tx: {
          ...(data.tx || {}),
          welcomeSentAt: FieldValue.serverTimestamp(),
          welcomeMessageId: messageId || null,
        },
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true }
    );

    return json({ ok: true, sent: true, messageId });
  } catch (e: any) {
    console.error("[POST /api/tx/welcome] error:", e);
    return json({ error: e?.message || "Server error" }, 500);
  }
}
