// src/app/(site)/api/subdomain-check/route.ts
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { Timestamp } from 'firebase-admin/firestore';
import { assertValidTenantId, normalizeTenantId } from '@/lib/tenant/validate';

const BLACKLIST = new Set(['www','app','api','admin','mail','root','support','status']);
const HOLD_MINUTES = 15;

function json(d: unknown, s = 200) {
  return NextResponse.json(d, { status: s });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const desiredRaw = String(body?.desiredSubdomain || '');
    const emailRaw   = String(body?.email || ''); // ← opcional (si lo pasas, mejor)

    const desired = normalizeTenantId(desiredRaw);
    if (!desired) return json({ available: false, reason: 'Invalid subdomain.' }, 200);
    assertValidTenantId(desired);
    if (BLACKLIST.has(desired)) return json({ available: false, reason: 'Reserved subdomain.' }, 200);

    const tRef = adminDb.doc(`tenants/${desired}`);
    const rRef = adminDb.doc(`reserved_subdomains/${desired}`);

    const [tSnap, rSnap] = await Promise.all([tRef.get(), rRef.get()]);

    // Si el tenant ya existe y está activo, no disponible
    if (tSnap.exists && (tSnap.get('status') !== 'draft' || tSnap.get('reservedFromSite') !== true)) {
      return json({ available: false, reason: 'Already taken.' }, 200);
    }

    const now = Timestamp.now();
    const holdUntil = rSnap.exists ? (rSnap.get('holdUntil') as Timestamp | null) : null;
    const reservedByEmail = (rSnap.exists ? (rSnap.get('reservedByEmail') as string | null) : null) || null;

    // ¿Sigue vigente?
    const isActiveHold = !!(holdUntil && holdUntil.toMillis() > now.toMillis());
    const normalizedEmail = emailRaw.trim().toLowerCase() || null;

    // Estrategia:
    // - Si hay hold vigente y NO es del mismo email → no disponible
    // - En cualquier otro caso, (re)tomamos o extendemos el hold a nuestro favor (si mandan email)
    if (isActiveHold && reservedByEmail && normalizedEmail && reservedByEmail !== normalizedEmail) {
      return json({ available: false, reason: 'This subdomain is being reserved. Try again later.' }, 200);
    }

    const newHold = Timestamp.fromMillis(now.toMillis() + HOLD_MINUTES * 60 * 1000);

    // Solo persistimos si tenemos un email (para que tenant-order pueda validar la autoría)
    if (normalizedEmail) {
      if (rSnap.exists) {
        await rRef.set(
          {
            name: desired,
            holdUntil: newHold,
            reservedByEmail: normalizedEmail,
            updatedAt: now,
            createdAt: rSnap.get('createdAt') || now,
          },
          { merge: true }
        );
      } else {
        await rRef.set({
          name: desired,
          holdUntil: newHold,
          reservedByEmail: normalizedEmail,
          createdAt: now,
          updatedAt: now,
        });
      }
    }

    return json({ available: true }, 200);
  } catch (e: any) {
    return json({ available: false, reason: e?.message || 'Error' }, 200);
  }
}
