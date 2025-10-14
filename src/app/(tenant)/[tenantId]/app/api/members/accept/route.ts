export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase/admin";
import { getAuth } from "firebase-admin/auth";
import { resolveTenantFromRequest, requireTenantId } from "@/lib/tenant/server";
import crypto from "crypto";

function json(d: unknown, s = 200) { return NextResponse.json(d, { status: s }); }
function hashToken(t: string): string { return crypto.createHash("sha256").update(t).digest("hex"); }

export async function GET(req: NextRequest, ctx: { params: { tenantId: string } }) {
  // GET acepta token por query y realiza el alta + redirección al login del tenant
  try {
    const tenantId = requireTenantId(resolveTenantFromRequest(req, ctx?.params), "api:members/accept:GET");
    const { searchParams } = new URL(req.url);
    const token = searchParams.get("token") || "";
    if (!token) return json({ error: "Missing token" }, 400);

    const tokenHash = hashToken(token);
    const invitesCol = adminDb.collection(`tenants/${tenantId}/invites`);
    const q = await invitesCol.where("tokenHash", "==", tokenHash).limit(1).get();
    if (q.empty) return json({ error: "Invalid or expired invite" }, 404);

    const inviteDoc = q.docs[0];
    const invite = inviteDoc.data() as any;

    if (invite.usedAt) return json({ error: "Invite already used" }, 409);
    if (invite.expiresAt?.toDate && invite.expiresAt.toDate() < new Date()) {
      return json({ error: "Invite expired" }, 410);
    }

    const email = String(invite.email || "").toLowerCase();
    const role  = String(invite.role || "").toLowerCase();

    // Busca/crea usuario Auth (si no existiera)
    const auth = getAuth();
    let uid: string;
    try {
      const u = await auth.getUserByEmail(email);
      uid = u.uid;
    } catch {
      // Si no existe, crea uno DISABLED=false, sin password. El usuario podrá establecerla con “reset password”.
      const created = await auth.createUser({
        email,
        emailVerified: false,
        disabled: false,
      });
      uid = created.uid;
      // (Opcional) enviar email de “set your password” por Firebase Auth o tu servicio de correo
    }

    // Siembra membresía
    const now = new Date();
    const mRef = adminDb.doc(`tenants/${tenantId}/members/${uid}`);
    await mRef.set({ uid, role, createdAt: now, updatedAt: now }, { merge: true });

    // Marca invite como usado
    await inviteDoc.ref.set({ usedAt: now }, { merge: true });

    // Redirige al login del tenant (para que haga sign-in y el refresh-role fije cookies)
    const loginUrl = `/${tenantId}/app/login`;
    return NextResponse.redirect(new URL(loginUrl, req.url));
  } catch (e: any) {
    return json({ error: e?.message || "Server error" }, 500);
  }
}

export async function POST(req: NextRequest, ctx: { params: { tenantId: string } }) {
  // Versión JSON (si prefieres manejar desde UI en cliente con fetch)
  try {
    const tenantId = requireTenantId(resolveTenantFromRequest(req, ctx?.params), "api:members/accept:POST");
    const body = await req.json().catch(() => ({}));
    const token = String(body?.token || "");
    if (!token) return json({ error: "Missing token" }, 400);

    const tokenHash = hashToken(token);
    const invitesCol = adminDb.collection(`tenants/${tenantId}/invites`);
    const q = await invitesCol.where("tokenHash", "==", tokenHash).limit(1).get();
    if (q.empty) return json({ error: "Invalid or expired invite" }, 404);

    const inviteDoc = q.docs[0];
    const invite = inviteDoc.data() as any;

    if (invite.usedAt) return json({ error: "Invite already used" }, 409);
    if (invite.expiresAt?.toDate && invite.expiresAt.toDate() < new Date()) {
      return json({ error: "Invite expired" }, 410);
    }

    const email = String(invite.email || "").toLowerCase();
    const role  = String(invite.role || "").toLowerCase();

    // Busca/crea usuario Auth (si no existiera)
    const auth = getAuth();
    let uid: string;
    try {
      const u = await auth.getUserByEmail(email);
      uid = u.uid;
    } catch {
      const created = await auth.createUser({ email, emailVerified: false, disabled: false });
      uid = created.uid;
    }

    const now = new Date();
    await adminDb.doc(`tenants/${tenantId}/members/${uid}`).set(
      { uid, role, createdAt: now, updatedAt: now },
      { merge: true }
    );
    await inviteDoc.ref.set({ usedAt: now }, { merge: true });

    return json({ ok: true, tenantId, uid, role });
  } catch (e: any) {
    return json({ error: e?.message || "Server error" }, 500);
  }
}
