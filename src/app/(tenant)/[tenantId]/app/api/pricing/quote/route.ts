// src/app/(tenant)/[tenant]/app/api/pricing/quote/route.ts
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { PricingQuoteSchema } from '@/lib/validators/cart';
import { priceCartItems } from '@/lib/server/pricing';

// ✅ Tenant (usa el import que me indicaste)
import { resolveTenantFromRequest, requireTenantId } from '@/lib/tenant/server';

// ✅ Auditoría opcional por tenant
import { tColAdmin } from '@/lib/db_admin';
import { FieldValue } from 'firebase-admin/firestore';

const json = (d: unknown, s = 200) => NextResponse.json(d, { status: s });

export async function POST(
  req: NextRequest,
  ctx: { params: { tenant: string } }
) {
  try {
    // TenantUpdate: resolver y exigir tenantId
    const tenantId = requireTenantId(
      resolveTenantFromRequest(req, ctx?.params),
      'api:/pricing/quote'
    );

    const ct = req.headers.get('content-type') || '';
    if (!ct.includes('application/json')) {
      return json({ error: 'Content-Type debe ser application/json' }, 415);
    }

    const raw = await req.json();
    const parsed = PricingQuoteSchema.safeParse(raw);
    if (!parsed.success) {
      // Audit: datos inválidos
      await tColAdmin('_admin_audit', tenantId).add({
        type: 'pricing_quote_invalid',
        tenantId,
        details: parsed.error.format?.() ?? 'zod_error',
        at: FieldValue.serverTimestamp(),
      });
      return json({ error: 'Datos inválidos', details: parsed.error.format() }, 422);
    }

    // ✅ Pasar tenantId al motor de precios (asumiendo que acepta contexto)
    // Si tu `priceCartItems` aún no soporta contexto, añade el segundo arg en su firma.
    const quote = await priceCartItems(parsed.data, { tenantId });

    // Audit: ok (ligero)
    await tColAdmin('_admin_audit', tenantId).add({
      type: 'pricing_quote_ok',
      tenantId,
      at: FieldValue.serverTimestamp(),
    });

    return json({ ok: true, quote }, 200);
  } catch (e: any) {
    // Errores de negocio conocidos → 422
    const known = new Set([
      'MENU_ITEM_NOT_FOUND',
      'MENU_ITEM_UNAVAILABLE',
      'CURRENCY_MISMATCH',
      'INVALID_GROUP_FOR_ITEM',
      'GROUP_MIN_VIOLATION',
      'GROUP_MAX_VIOLATION',
      'OPTION_NOT_FOUND',
      'OPTION_INACTIVE',
      'OPTION_WRONG_GROUP',
    ]);
    if (known.has(e?.message)) {
      // Intento de auditoría con tenant si es resolvible
      try {
        const tenantId = resolveTenantFromRequest(req, ctx?.params) || 'unknown';
        await tColAdmin('_admin_audit', tenantId).add({
          type: 'pricing_quote_rejected',
          tenantId,
          code: e.message,
          at: FieldValue.serverTimestamp(),
        });
      } catch { /* no-op */ }
      return json({ error: 'Selección inválida', code: e.message }, 422);
    }

    console.error('POST /pricing/quote error:', e);
    // Audit: error interno
    try {
      const tenantId = resolveTenantFromRequest(req, ctx?.params) || 'unknown';
      await tColAdmin('_admin_audit', tenantId).add({
        type: 'pricing_quote_error',
        tenantId,
        error: String(e?.message || e),
        at: FieldValue.serverTimestamp(),
      });
    } catch { /* no-op */ }

    return json({ error: 'Internal error' }, 500);
  }
}
