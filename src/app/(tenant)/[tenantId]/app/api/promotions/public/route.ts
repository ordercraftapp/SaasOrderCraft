// src/app/(tenant)/[tenant]/app/api/promotions/public/route.ts
export const runtime = 'nodejs';

import { NextResponse } from 'next/server';

// ✅ Tenant helpers
import { resolveTenantFromRequest, requireTenantId } from '@/lib/tenant/server';

// ✅ Firestore (Admin) tenant-aware
import { tColAdmin } from '@/lib/db_admin';
import { FieldValue } from 'firebase-admin/firestore';

function toJsDate(x: any): Date | null {
  if (!x) return null;
  if (typeof x?.toDate === 'function') {
    try { return x.toDate(); } catch { return null; }
  }
  const d = new Date(x);
  return isNaN(d.getTime()) ? null : d;
}

export async function GET(
  req: Request,
  ctx: { params: { tenant: string } }
) {
  try {
    // 🔐 Tenant obligatorio
    const tenantId = requireTenantId(
      resolveTenantFromRequest(req as any, ctx?.params),
      'api:/promotions/public'
    );

    // Leer promos activas del tenant
    const snap = await tColAdmin('promotions', tenantId)
      .where('active', '==', true)
      .get();

    const now = new Date();
    const items = snap.docs
      .map((d) => ({ id: d.id, ...(d.data() as any) }))
      .filter((p) => {
        const start = toJsDate(p.startAt);
        const end = toJsDate(p.endAt);
        const activeWindow = (!start || now >= start) && (!end || now <= end);
        return p?.code && p?.active !== false && activeWindow;
      })
      .map((p) => ({
        id: p.id,
        name: p.name ?? p.title ?? 'Promoción',
        title: p.title ?? p.name ?? 'Promoción',
        code: String(p.code || '').toUpperCase().trim(),
        // 👉 expón aquí más campos públicos si hace falta (ej. description, badge, etc.)
      }));

    // Dedupe por code
    const seen = new Set<string>();
    const deduped = items.filter((it) => {
      const k = it.code;
      if (!k || seen.has(k)) return false;
      seen.add(k);
      return true;
    });

    // Auditoría ligera (opcional)
    await tColAdmin('_admin_audit', tenantId).add({
      type: 'promotions_public_list',
      tenantId,
      count: deduped.length,
      at: FieldValue.serverTimestamp(),
    });

    return NextResponse.json({ ok: true, items: deduped }, { status: 200 });
  } catch (e: any) {
    try {
      const maybeTenant = resolveTenantFromRequest(req as any, ctx?.params) || 'unknown';
      await tColAdmin('_admin_audit', maybeTenant).add({
        type: 'promotions_public_error',
        tenantId: maybeTenant,
        error: String(e?.message || e),
        at: FieldValue.serverTimestamp(),
      });
    } catch { /* no-op */ }

    console.error('[GET /api/promotions/public] error:', e);
    return NextResponse.json(
      { ok: false, error: e?.message || 'Internal error' },
      { status: 500 }
    );
  }
}
