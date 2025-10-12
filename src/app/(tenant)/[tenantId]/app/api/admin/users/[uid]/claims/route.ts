// src/app/(tenant)/[tenantId]/app/api/admin/users/[uid]/claims/route.ts
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { getUserFromRequest } from '@/lib/server/auth';
import { resolveTenantFromRequest, requireTenantId } from '@/lib/tenant/server';
import { ensureAdmin, tColAdmin } from '@/lib/db_admin';

const json = (d: unknown, s = 200) => NextResponse.json(d, { status: s });

const BodySchema = z.object({
  admin: z.boolean().optional(),
  kitchen: z.boolean().optional(),
  waiter: z.boolean().optional(),
  delivery: z.boolean().optional(),
});

function requireSecret(req: NextRequest) {
  const hdr = req.headers.get('x-admin-secret')?.trim();
  const expected = process.env.ADMIN_TASKS_SECRET?.trim();
  return Boolean(expected && hdr && hdr === expected);
}

// Helper robusto para admin (evita TS en user.isAdmin/claims)
function isAdminUser(user: any): boolean {
  return (
    user?.role === 'admin' ||
    user?.isAdmin === true ||
    user?.claims?.admin === true
  );
}

export async function POST(
  req: NextRequest,
  { params }: { params: { tenantId: string; uid: string } }
) {
  try {
    // 🔐 Tenant
    const tenantId = requireTenantId(
      resolveTenantFromRequest(req, params),
      'api:admin/users/[uid]/claims:POST'
    );

    // 🔐 Auth del actor
    const me = await getUserFromRequest(req);
    if (!me || !isAdminUser(me)) return json({ error: 'Forbidden' }, 403);
    if (!requireSecret(req)) return json({ error: 'Missing/invalid secret' }, 401);

    const uid = params.uid;
    const raw = await req.json();
    const parsed = BodySchema.safeParse(raw);
    if (!parsed.success) {
      return json({ error: 'Datos inválidos', details: parsed.error.format() }, 422);
    }

    // Solo claves definidas
    const toSet: Record<string, boolean> = {};
    for (const k of ['admin', 'kitchen', 'waiter', 'delivery'] as const) {
      const v = (parsed.data as any)[k];
      if (typeof v === 'boolean') toSet[k] = v;
    }

    // Inicializa Admin SDK y auth
    const adminApp = ensureAdmin();
    const auth = adminApp.auth();

    // Mezclar con claims actuales (sin borrar otros)
    const userRec = await auth.getUser(uid);
    const current = (userRec.customClaims as Record<string, any>) || {};
    const next = { ...current, ...toSet };

    await auth.setCustomUserClaims(uid, next);

    // 🧾 Auditoría por tenant
    await tColAdmin('_admin_audit', tenantId).add({
      at: new Date().toISOString(),
      by: (me as any)?.uid ?? (me as any)?.id ?? null,
      target: uid,
      claims: next,
      type: 'setCustomClaims',
      tenantId, // ✅ regla de estilo
    });

    return json({ ok: true, uid, claims: next, tenantId }, 200);
  } catch (e: any) {
    console.error('POST /admin/users/[uid]/claims error:', e);
    return json({ error: e?.message ?? 'Internal error' }, 500);
  }
}
