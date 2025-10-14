export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { getUserFromRequest } from "@/lib/server/auth";
import { resolveTenantFromRequest, requireTenantId } from "@/lib/tenant/server";
import { requireTenantAdmin, isValidOpRole } from "@/lib/tenant/authz";
import { sendTransactionalEmail } from "@/lib/email/brevoTx";
import crypto from "crypto";

const INVITE_HOURS = 72;

function json(d: unknown, s = 200) { return NextResponse.json(d, { status: s }); }

function makeToken(): string {
  return crypto.randomBytes(24).toString("base64url"); // URL-safe
}
function hashToken(t: string): string {
  return crypto.createHash("sha256").update(t).digest("hex");
}

function buildAcceptUrl(tenantId: string, token: string) {
  // Puedes crear luego una página /{tenantId}/app/join que consuma este token
  return `/${tenantId}/app/api/members/accept?token=${encodeURIComponent(token)}`;
}

export async function POST(req: NextRequest, ctx: { params: { tenantId: string } }) {
  try {
    const tenantId = requireTenantId(resolveTenantFromRequest(req, ctx?.params), "api:members/invite:POST");
    const me = await getUserFromRequest(req);
    if (!me) return json({ error: "Unauthorized" }, 401);
    await requireTenantAdmin(tenantId, me.uid);

    const body = await req.json().catch(() => ({}));
    const email = String(body?.email || "").trim().toLowerCase();
    const name  = (body?.name || "").toString().trim() || null;
    const role  = String(body?.role || "").trim().toLowerCase();

    if (!email || !email.includes("@")) return json({ error: "Invalid email" }, 400);
    if (!isValidOpRole(role)) return json({ error: "Invalid role" }, 400);

    // Idempotencia simple: evita duplicar invites activos al mismo correo/rol
    const invitesCol = adminDb.collection(`tenants/${tenantId}/invites`);
    const active = await invitesCol
      .where("email", "==", email)
      .where("role", "==", role)
      .where("usedAt", "==", null)
      .orderBy("createdAt", "desc")
      .limit(1)
      .get();

    if (!active.empty) {
      const doc = active.docs[0];
      return json({ ok: true, inviteId: doc.id, already: true });
    }

    const token = makeToken();
    const tokenHash = hashToken(token);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + INVITE_HOURS * 3600 * 1000);

    const inviteRef = invitesCol.doc();
    await inviteRef.set({
      email, name, role,
      tokenHash,
      expiresAt,
      usedAt: null,
      createdAt: now,
      createdBy: { uid: me.uid, email: me.email || null },
    });

    // Email con link (puedes personalizar HTML)
    const acceptUrl = buildAcceptUrl(tenantId, token);
    try {
      await sendTransactionalEmail({
        toEmail: email,
        toName: name || "",
        subject: `You've been invited to ${tenantId}`,
        html: `
          <p>Hello${name ? " " + name : ""},</p>
          <p>You were invited to join <strong>${tenantId}</strong> as <strong>${role}</strong>.</p>
          <p><a href="${acceptUrl}">Accept invitation</a> (this link expires in ${INVITE_HOURS} hours)</p>
        `,
        text: `Accept your invite to ${tenantId} as ${role}: ${acceptUrl}`,
      });
    } catch (e) {
      // Si falla el email, mantenemos el invite creado (lo puedes reenviar)
      console.error("[invite] email send failed:", e);
    }

    return json({ ok: true, inviteId: inviteRef.id });
  } catch (e: any) {
    const status = e?.status || 500;
    return json({ error: e?.message || "Server error" }, status);
  }
}
