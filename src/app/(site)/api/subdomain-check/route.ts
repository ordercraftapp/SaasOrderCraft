// src/app/(site)/api/subdomain-check/route.ts
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { adminDb } from '@/lib/firebase/admin';
import { Timestamp } from 'firebase-admin/firestore';
import { normalizeTenantId, assertValidTenantId } from '@/lib/tenant/validate';

const HOLD_MINUTES = 15;

// Palabras reservadas
const BLACKLIST = new Set([
  'www', 'app', 'api', 'admin', 'mail', 'root', 'support', 'status',
  'static', 'assets', 'cdn', 'img', 'images', 'files',
]);

function json(d: unknown, s = 200) {
  return NextResponse.json(d, { status: s });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const raw = String(body?.desiredSubdomain || '').trim();
    const desired = normalizeTenantId(raw);

    if (!desired) return json({ available: false, reason: 'Invalid subdomain.' }, 200);
    assertValidTenantId(desired);

    if (BLACKLIST.has(desired)) {
      return json({ available: false, reason: 'This name is reserved.' }, 200);
    }

    // ¿Ya existe el tenant?
    const tRef = adminDb.doc(`tenants/${desired}`);
    const tSnap = await tRef.get();
    if (tSnap.exists) {
      return json({ available: false, reason: 'This subdomain is already taken.' }, 200);
    }

    // ¿Está reservado?
    const rRef = adminDb.doc(`reserved_subdomains/${desired}`);
    const rSnap = await rRef.get();
    const now = Timestamp.now();

    if (rSnap.exists) {
      const holdUntil = rSnap.get('holdUntil') as Timestamp | null;
      if (holdUntil && holdUntil.toMillis() > now.toMillis()) {
        return json({ available: false, reason: 'This subdomain is being reserved. Try again later.' }, 200);
      }
    }

    // Reservar/renovar 15 min
    const holdUntil = Timestamp.fromMillis(now.toMillis() + HOLD_MINUTES * 60 * 1000);
    await rRef.set(
      { name: desired, holdUntil, createdAt: rSnap.exists ? rSnap.get('createdAt') || now : now, updatedAt: now },
      { merge: true },
    );

    return json({ available: true }, 200);
  } catch (err: any) {
    return json({ available: false, reason: err?.message || 'Unexpected error.' }, 200);
  }
}
