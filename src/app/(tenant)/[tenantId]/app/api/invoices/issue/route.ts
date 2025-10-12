// src/app/(tenant)/[tenantId]/app/api/invoices/issue/route.ts
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import { FieldValue } from 'firebase-admin/firestore';
import { resolveTenantFromRequest, requireTenantId } from '@/lib/tenant/server';
import { ensureAdmin } from '@/lib/db_admin';

type InvoiceNumbering = {
  enabled?: boolean;
  series?: string;
  prefix?: string;
  suffix?: string;
  padding?: number; // ej. 6 → 000123
  resetPolicy?: 'never' | 'yearly' | 'monthly' | 'daily';
};

type TaxProfile = {
  b2bConfig?: {
    invoiceNumbering?: InvoiceNumbering;
  };
  // ...otros campos que ya usas
};

function composeInvoiceNumber(cfg: InvoiceNumbering, n: number) {
  const pad = Math.max(0, cfg.padding ?? 0);
  const num = String(n).padStart(pad, '0');
  const parts = [cfg.prefix || '', cfg.series || '', num, cfg.suffix || ''].filter(Boolean);
  return parts.join(''); // ejemplo: prefABC000123suf (ajusta si quieres guiones)
}

function counterDocKeys(now = new Date()) {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return {
    keyYear: `year-${y}`,
    keyMonth: `month-${y}-${m}`,
    keyDay: `day-${y}-${m}-${d}`,
  };
}

export async function POST(req: NextRequest, { params }: { params: { tenantId: string } }) {
  try {
    const tenantId = requireTenantId(resolveTenantFromRequest(req, params), 'api:invoices/issue:POST');

    const { orderId } = await req.json();
    if (!orderId) {
      return NextResponse.json({ ok: false, reason: 'Missing orderId' }, { status: 400 });
    }

    // ✅ Firestore Admin
    const db = ensureAdmin().firestore();

    // 1) Leer perfil activo del tenant
    // Estructura elegida: tenants/{tenantId}/settings/taxProfiles/active
    const profRef = db.doc(`tenants/${tenantId}/settings/taxProfiles/active`);
    const profSnap = await profRef.get();
    if (!profSnap.exists) {
      return NextResponse.json({ ok: false, reason: 'No active tax profile' }, { status: 400 });
    }
    const profile = profSnap.data() as TaxProfile;
    const inv = profile?.b2bConfig?.invoiceNumbering;
    if (!inv?.enabled) {
      return NextResponse.json({ ok: false, reason: 'Invoice numbering disabled' }, { status: 400 });
    }

    // 2) Transacción: consumir contador y escribir en la orden del tenant
    const now = new Date();
    const { keyYear, keyMonth, keyDay } = counterDocKeys(now);

    const countersRef = db.doc(`tenants/${tenantId}/counters/invoiceNumbering`);
    const orderRef = db.doc(`tenants/${tenantId}/orders/${orderId}`);

    const result = await db.runTransaction(async (tx) => {
      const countersSnap = await tx.get(countersRef);
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists) throw new Error('Order not found');

      const o: any = orderSnap.data() || {};
      if (o.invoiceNumber) {
        // Idempotencia: si ya tiene número, devuelve el mismo
        return {
          invoiceNumber: o.invoiceNumber,
          issuedAt: o.invoiceIssuedAt ?? null,
          series: o.invoiceSeries ?? null,
        };
      }

      // Clave del periodo según resetPolicy
      const key =
        inv.resetPolicy === 'daily'
          ? keyDay
          : inv.resetPolicy === 'monthly'
          ? keyMonth
          : inv.resetPolicy === 'yearly'
          ? keyYear
          : 'global';

      const data = countersSnap.exists ? (countersSnap.data() as any) : {};
      const current = Number(data?.[key]?.next ?? 1);
      const next = current + 1;

      // Componer número y avanzar contador
      const invoiceNumber = composeInvoiceNumber(inv, current);

      tx.set(
        countersRef,
        {
          [key]: { next },
          updatedAt: FieldValue.serverTimestamp(),
          tenantId, // ✅ regla de estilo
        },
        { merge: true }
      );

      tx.update(orderRef, {
        tenantId, // ✅
        invoiceNumber,
        invoiceSeries: inv.series || null,
        invoiceIssuedAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
      });

      return {
        invoiceNumber,
        issuedAt: new Date().toISOString(),
        series: inv.series || null,
      };
    });

    return NextResponse.json({ ok: true, tenantId, ...result });
  } catch (e: any) {
    console.error('[invoices/issue] error', e);
    return NextResponse.json({ ok: false, reason: e?.message || 'Server error' }, { status: 500 });
  }
}
