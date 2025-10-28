export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { Timestamp } from 'firebase-admin/firestore';
import { normalizeTenantId, assertValidTenantId } from '@/lib/tenant/validate';
import { getAuth } from 'firebase-admin/auth';
import { sendTransactionalEmail } from '@/lib/email/brevoTx';

type PlanId = 'starter' | 'pro' | 'full';

type CreateOrderBody = {
  plan: PlanId; // entrada sigue llamándose 'plan' en el payload
  companyName: string;
  adminName: string;
  adminEmail: string;
  adminPassword: string;
  phone?: string;
  address: {
    line1: string;
    line2?: string;
    city: string;
    region?: string;
    country: string;
    postalCode?: string;
  };
  desiredSubdomain: string;
};

function json(d: unknown, s = 200) {
  return NextResponse.json(d, { status: s });
}

const BLACKLIST = new Set(['www', 'app', 'api', 'admin', 'mail', 'root', 'support', 'status']);
const HOLD_MINUTES = 15;

// 🧮 precios por plan (mensual) en centavos
const PLAN_PRICE_CENTS: Record<PlanId, number> = {
  starter: 1999,
  pro: 2999,
  full: 3499,
};

function fmtMoney(cents: number, currency: string) {
  const v = cents / 100;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(v);
  } catch {
    return `${v.toFixed(2)} ${currency}`;
  }
}

/** 🔗 URL de login del tenant */
function buildLoginUrl(tenantId: string) {
  const baseDomain = (process.env.NEXT_PUBLIC_BASE_DOMAIN || 'datacraftcoders.cloud').toLowerCase();
  const supportsWildcard = process.env.NEXT_PUBLIC_USE_WILDCARD_SUBDOMAINS?.toLowerCase() !== 'false';
  return supportsWildcard ? `https://${tenantId}.${baseDomain}/app/login` : `/${tenantId}/app/login`;
}

/** =========================
 *  Correo (HTML) con plan/precio y trial opcional
 *  ========================= */
function welcomeHtml(params: {
  tenantId: string;
  adminName: string;
  plan: PlanId;
  priceLabel: string; // p.ej. "$19.99 USD / month"
  trialEndsAt?: Date | null; // si viene, se muestra la línea de trial
}) {
  const { tenantId, adminName, plan, priceLabel, trialEndsAt } = params;
  const loginUrl = buildLoginUrl(tenantId);
  const safeName = (adminName || '').trim();
  const trialSection = trialEndsAt
    ? `<p style="margin:0 0 10px 0;font-size:15px;line-height:1.6;color:#374151;">
         <strong>Free trial:</strong> ends on <strong>${trialEndsAt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</strong>.
       </p>`
    : '';

  return `
  <div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#fff;opacity:0;">
    Your workspace is almost ready!
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
              <h1 style="margin:0 0 8px 0;font-size:22px;line-height:1.35;color:#111827;">
                ${safeName ? `Welcome, ${safeName}!` : 'Welcome!'} 🎉
              </h1>
              <p style="margin:0 0 10px 0;font-size:15px;line-height:1.6;color:#374151;">
                Your restaurant workspace has been created.
              </p>
              <p style="margin:0 0 10px 0;font-size:15px;line-height:1.6;color:#374151;">
                <strong>Plan:</strong> ${plan.charAt(0).toUpperCase() + plan.slice(1)} — <strong>${priceLabel}</strong>
              </p>
              ${trialSection}
              <p style="margin:0 0 10px 0;font-size:15px;line-height:1.6;color:#374151;">
                You can sign in here:
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 24px 18px 24px;">
              <table role="presentation" cellpadding="0" cellspacing="0">
                <tr>
                  <td align="center" style="border-radius:10px;background:#0d6efd;">
                    <a href="${loginUrl}" target="_blank" rel="noopener noreferrer"
                      style="display:inline-block;padding:12px 18px;color:#ffffff;text-decoration:none;font-family:Arial,Helvetica,sans-serif;font-size:15px;font-weight:700;">
                      Go to Login
                    </a>
                  </td>
                </tr>
              </table>
              <p style="margin:10px 0 0 0;font-size:12px;color:#6b7280;font-family:Arial,Helvetica,sans-serif;">
                Or paste this link into your browser: <a href="${loginUrl}" style="color:#2563eb;text-decoration:underline;">${loginUrl.replace(/^https?:\/\//, "")}</a>
              </p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 24px 24px 24px;font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#6b7280;">
              <p style="margin:0;">If you have any questions, just reply to this email — we’re happy to help.</p>
              <p style="margin:0;color:#9ca3af;">© ${new Date().getFullYear()} OrderCraft</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>`;
}

/** =========================
 *  Correo (texto plano) con plan/precio y trial opcional
 *  ========================= */
function welcomeText(params: {
  tenantId: string;
  plan: PlanId;
  priceLabel: string;
  trialEndsAt?: Date | null;
}) {
  const { tenantId, plan, priceLabel, trialEndsAt } = params;
  const loginUrl = buildLoginUrl(tenantId);
  const planLine = `Plan: ${plan.charAt(0).toUpperCase() + plan.slice(1)} — ${priceLabel}`;
  const trialLine = trialEndsAt
    ? `Free trial ends on: ${trialEndsAt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}`
    : null;

  return `Welcome!

Your restaurant workspace has been created.
${planLine}
${trialLine ? trialLine + '\n' : ''}

Open your login page: ${loginUrl}

If you have any questions, just reply to this email.`;
}

/** =========================
 *  POST: crea tenant draft + Auth owner + tenantOrder (idempotente)
 *  ========================= */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as CreateOrderBody;

    // -------- Validaciones básicas --------
    const plan = (body?.plan || 'starter') as PlanId;
    if (!['starter', 'pro', 'full'].includes(plan)) return json({ error: 'Invalid plan.' }, 400);

    const adminEmail = String(body?.adminEmail || '').trim().toLowerCase();
    if (!adminEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(adminEmail)) {
      return json({ error: 'Please provide a valid email.' }, 400);
    }

    const adminPassword = String(body?.adminPassword || '');
    if (adminPassword.length < 8) {
      return json({ error: 'Password must be at least 8 characters.' }, 400);
    }

    const adminName = String(body?.adminName || '').trim();
    const companyName = String(body?.companyName || '').trim();
    if (!adminName || !companyName) return json({ error: 'Missing required fields.' }, 400);

    const desired = normalizeTenantId(String(body?.desiredSubdomain || ''));
    if (!desired) return json({ error: 'Invalid subdomain.' }, 400);
    assertValidTenantId(desired);
    if (BLACKLIST.has(desired)) return json({ error: 'This subdomain is reserved.' }, 400);

    const address = body?.address || ({} as any);
    if (!address.line1 || !address.city || !address.country) {
      return json({ error: 'Address is incomplete.' }, 400);
    }

    // -------- Refs --------
    const tRef = adminDb.doc(`tenants/${desired}`);
    const rRef = adminDb.doc(`reserved_subdomains/${desired}`);
    const ordersCol = adminDb.collection(`tenants/${desired}/tenantOrders`);

    // -------- Idempotencia previa a escribir --------
    const existingTenantSnap = await tRef.get();
    if (existingTenantSnap.exists) {
      const t = existingTenantSnap.data() || {};
      if (t.status === 'draft' && t.reservedFromSite === true) {
        const q = await ordersCol
          .where('orderStatus', '==', 'created')
          .orderBy('createdAt', 'desc')
          .limit(1)
          .get();

        if (!q.empty) {
          // ----- Bootstrap defensivo en idempotencia -----
          try {
            const now = Timestamp.now();
            const maxByPlan = plan === 'pro' ? 10 : plan === 'full' ? 20 : 5;
            await Promise.all([
              adminDb.doc(`tenants/${desired}/paymentProfile/default`).set(
                {
                  tenantId: desired,
                  cash: true,
                  card: false,
                  paypal: false,
                  createdAt: now,
                },
                { merge: true },
              ),
              adminDb.doc(`tenants/${desired}/settings/general`).set(
                {
                  createdAt: now,
                  currency: 'USD',
                  currencyLocale: 'en-US',
                  language: 'en',
                },
                { merge: true },
              ),
              adminDb.doc(`tenants/${desired}/system_flags/marketing`).set(
                {
                  tenantId: desired,
                  maxCampaignsPerMonth: maxByPlan,
                  updatedAt: now,
                  createdAt: now,
                },
                { merge: true },
              ),
            ]);
          } catch (e) {
            console.error('[tenant-order:idempotent] bootstrap docs failed:', e);
          }

          const doc = q.docs[0];
          const res = json({ tenantId: desired, orderId: doc.id }, 200);
          res.cookies.set('tenantId', desired, { path: '/', httpOnly: false });
          return res;
        }
      }
      return json({ error: 'This subdomain is already taken.' }, 409);
    }

    // -------- Crear/obtener usuario Auth (antes) --------
    const auth = getAuth();
    let ownerUid: string;
    try {
      const created = await auth.createUser({
        email: adminEmail,
        emailVerified: false,
        password: adminPassword,
        displayName: adminName,
        disabled: false,
      });
      ownerUid = created.uid;
    } catch (e: any) {
      if (e?.code === 'auth/email-already-exists') {
        const existing = await auth.getUserByEmail(adminEmail);
        ownerUid = existing.uid;
      } else {
        throw e;
      }
    }

    // -------- Transacción: reserva + crear tenant draft + order --------
    const result = await adminDb.runTransaction(async (trx) => {
      const now = Timestamp.now();

      // Carrera: ¿alguien creó el tenant?
      const tSnap = await trx.get(tRef);
      if (tSnap.exists) throw new Error('This subdomain is already taken.');

      // Reserva (con validación del propietario del hold)
      const rSnap = await trx.get(rRef);
      const newHold = Timestamp.fromMillis(now.toMillis() + HOLD_MINUTES * 60 * 1000);

      if (rSnap.exists) {
        const holdUntil = rSnap.get('holdUntil') as Timestamp | null;
        const reservedByEmail = (rSnap.get('reservedByEmail') as string | null) || null;

        const isActiveHold = !!(holdUntil && holdUntil.toMillis() > now.toMillis());
        if (isActiveHold && reservedByEmail && reservedByEmail !== adminEmail) {
          // Otro usuario está reservando activamente → bloquea
          throw new Error('This subdomain is being reserved. Try again later.');
        }

        // Si no hay dueño o es el mismo email → renueva/reasigna el hold a este email
        trx.set(
          rRef,
          {
            name: desired,
            holdUntil: newHold,
            reservedByEmail: adminEmail,
            updatedAt: now,
            createdAt: rSnap.get('createdAt') || now,
          },
          { merge: true },
        );
      } else {
        // Crear hold nuevo, asignado a este email
        trx.set(rRef, {
          name: desired,
          holdUntil: newHold,
          reservedByEmail: adminEmail,
          createdAt: now,
          updatedAt: now,
        });
      }

      // Crear tenant (draft) — ahora con owner.uid
      trx.set(tRef, {
        tenantId: desired,
        planTier: plan, // ← renombrado (antes: plan)
        status: 'draft',
        features: [], // se aplicarán en /provision-tenant
        owner: { name: adminName, email: adminEmail, uid: ownerUid },
        company: {
          name: companyName,
          address: {
            line1: address.line1,
            line2: address.line2 || null,
            city: address.city,
            region: address.region || null,
            country: address.country,
            postalCode: address.postalCode || null,
          },
          phone: body?.phone || null,
        },
        reservedFromSite: true,
        createdAt: now,
        updatedAt: now,
        customDomain: null,
      });

      // Crear order (created) — ⬇️ aquí seteamos monto y moneda
      const orderRef = ordersCol.doc();
      trx.set(orderRef, {
        orderId: orderRef.id,
        planTier: plan, // ← renombrado (antes: plan)
        desiredSubdomain: desired,
        customer: { name: adminName, email: adminEmail },
        address: {
          line1: address.line1,
          line2: address.line2 || null,
          city: address.city,
          region: address.region || null,
          country: address.country,
          postalCode: address.postalCode || null,
        },
        amountCents: PLAN_PRICE_CENTS[plan], // ← monto por plan
        currency: 'USD',                     // ← moneda
        paymentStatus: 'pending',
        orderStatus: 'created',
        createdAt: now,
        updatedAt: now,
      });

      // ------- Bootstrap: paymentProfile/default y settings/general (transaccional) -------
      trx.set(
        adminDb.doc(`tenants/${desired}/paymentProfile/default`),
        {
          tenantId: desired,
          cash: true,
          card: false,    // tarjeta desactivada por defecto
          paypal: false,  // PayPal desactivado por defecto
          createdAt: now,
        },
        { merge: true },
      );

      trx.set(
        adminDb.doc(`tenants/${desired}/settings/general`),
        {
          createdAt: now,
          currency: 'USD',
          currencyLocale: 'en-US',
          language: 'en',
        },
        { merge: true },
      );

      // 🟩 NUEVO: sembrar system_flags/marketing con el límite mensual según plan
      const maxByPlan = plan === 'pro' ? 10 : plan === 'full' ? 20 : 5;
      trx.set(
        adminDb.doc(`tenants/${desired}/system_flags/marketing`),
        {
          tenantId: desired,
          maxCampaignsPerMonth: maxByPlan,
          createdAt: now,
          updatedAt: now,
        },
        { merge: true },
      );

      return { tenantId: desired, orderId: orderRef.id, ownerUid };
    });

    // Email de bienvenida (no bloqueante) — con plan/precio y trial opcional
    try {
      const priceLabel = `${fmtMoney(PLAN_PRICE_CENTS[body.plan], 'USD')} / month`;
      // ⬇️ Si más adelante llamas este correo desde un flujo de trial, pásale la fecha real:
      // const trialEndsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
      const trialEndsAt: Date | undefined = undefined;

      const html = welcomeHtml({
        tenantId: result.tenantId,
        adminName: body.adminName,
        plan: body.plan,
        priceLabel,
        trialEndsAt,
      });

      const text = welcomeText({
        tenantId: result.tenantId,
        plan: body.plan,
        priceLabel,
        trialEndsAt,
      });

      await sendTransactionalEmail({
        toEmail: String(body.adminEmail || '').trim().toLowerCase(),
        toName: body.adminName || '',
        subject: `Your workspace "${result.tenantId}" is ready — ${body.plan.toUpperCase()} plan`,
        html,
        text,
      });
    } catch (e) {
      console.error('[tenant-order] email send failed:', e);
    }

    const res = json({ tenantId: result.tenantId, orderId: result.orderId }, 200);
    res.cookies.set('tenantId', result.tenantId, { path: '/', httpOnly: false });
    return res;
  } catch (err: any) {
    const msg = err?.message || 'Unexpected error.';
    const status = /taken|exists|reserved|being reserved/i.test(msg) ? 409 : 500;
    return json({ error: msg }, status);
  }
}

/** =========================
 *  GET: obtener resumen para checkout
 *  ========================= */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const tenantIdRaw = String(searchParams.get('tenantId') || '').trim();
    const orderId = String(searchParams.get('orderId') || '').trim();

    const tenantId = normalizeTenantId(tenantIdRaw);
    if (!tenantId || !orderId) return json({ error: 'Missing params.' }, 400);
    assertValidTenantId(tenantId);

    const tRef = adminDb.doc(`tenants/${tenantId}`);
    const oRef = adminDb.doc(`tenants/${tenantId}/tenantOrders/${orderId}`);

    const [tSnap, oSnap] = await Promise.all([tRef.get(), oRef.get()]);
    if (!tSnap.exists || !oSnap.exists) return json({ error: 'Not found.' }, 404);

    const tData = tSnap.data() as any;
    const oData = oSnap.data() as any;

    // ---------- Normalización defensiva de plan ----------
    const allowed: PlanId[] = ['starter', 'pro', 'full'];
    const candidate =
      (tData?.planTier as PlanId | undefined) ??
      (tData?.plan as PlanId | undefined) ??
      (oData?.planTier as PlanId | undefined) ??
      (oData?.plan as PlanId | undefined);

    const planTier: PlanId = allowed.includes((candidate as any)) ? (candidate as PlanId) : 'starter';

    const summary = {
      tenantId,
      orderId,
      planTier, // ← API ahora expone planTier
      status: tData.status,
      desiredSubdomain: oData.desiredSubdomain,
      customer: oData.customer,
      company: tData.company,
      amountCents: oData.amountCents,
      currency: oData.currency,
      paymentStatus: oData.paymentStatus,
      orderStatus: oData.orderStatus,
      createdAt: oData.createdAt,
    };

    return json(summary, 200);
  } catch (err: any) {
    return json({ error: err?.message || 'Unexpected error.' }, 500);
  }
}
