// src/app/(tenant)/[tenant]/app/admin/reports/taxes/page.tsx
'use client';
import { getAuth } from 'firebase/auth'; 
import { useEffect, useMemo, useState } from 'react';
import Protected from '@/app/(tenant)/[tenantId]/components/Protected';
import AdminOnly from '@/app/(tenant)/[tenantId]/components/AdminOnly';
import ToolGate from '@/components/ToolGate';
import "@/lib/firebase/client";
import {
  query as fsQuery,
  where,
  getDocs,
  orderBy,
  limit,
  Timestamp,
} from 'firebase/firestore';
import { saveAs } from 'file-saver';

// ✅ tenant-aware DB helpers
import { tCol } from '@/lib/db';
import { useTenantId } from '@/lib/tenant/context';

// Perfil activo para el panel lateral
import { getActiveTaxProfile, type TaxProfile } from '@/lib/tax/profile';

// 🔤 i18n
import { t as translate } from '@/lib/i18n/t';
import { useTenantSettings } from '@/lib/settings/hooks';

/* =========================
   Tipos y utilidades base
   ========================= */
type Row = {
  date: string;
  orderId: string;
  taxCents: number;
  baseCents: number;
  rateLabel: string;
  currency: string;
};

// Dataset enriquecido por orden para Fase D
type OrderSnapshotLite = {
  id: string;
  date: string;                 // ISO YYYY-MM-DD
  currency: string;
  jurisdictionApplied: string;
  orderType: '' | 'dine-in' | 'delivery' | 'pickup';
  summaryByRate: Array<{
    rateCode: string;
    rateBps?: number;
    ratePct?: number;
    baseCents?: number;
    taxCents?: number;
  }>;
  zeroBaseCents: number;
  exemptBaseCents: number;
  serviceBaseCents: number;
  serviceTaxCents: number;
  b2bTaxId?: string | null;
  orderTaxableBaseCents: number;
  orderTaxCents: number;
  orderTotalCents: number;
};

type ReportTab = 'lines' | 'summary' | 'vatbook' | 'b2b';

type Filters = {
  jurisdiction: string;
  orderType: '' | 'dine-in' | 'delivery' | 'pickup';
  rateCode: string;
  b2bOnly: boolean;
};

function startOfDayLocal(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function endOfDayLocal(d: Date) {
  const x = new Date(d);
  x.setHours(23, 59, 59, 999);
  return x;
}
function parseInputDate(s: string): Date | null {
  if (!s) return null;
  const [y, m, d] = s.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}
function cents(n?: number | null) {
  return Number.isFinite(Number(n)) ? Number(n) : 0;
}
function fmtMoneyCents(v: number, currency = 'USD') {
  const n = (v ?? 0) / 100;
  try { return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n); }
  catch { return `${currency} ${n.toFixed(2)}`; }
}
function safeStr(v: any) { return (v ?? '').toString(); }

/* =========================
   Componente principal
   ========================= */
export default function TaxesReportPage() {
  const tenantId = useTenantId() as string;

  // 🔤 idioma actual
  const { settings } = useTenantSettings();
  const lang = useMemo(() => {
    try {
      if (typeof window !== 'undefined') {
        const ls = localStorage.getItem('tenant.language');
        if (ls) return ls;
      }
    } catch {}
    return (settings as any)?.language;
  }, [settings]);
  const tt = (key: string, fallback: string, vars?: Record<string, unknown>) => {
    const s = translate(lang, key, vars);
    return s === key ? fallback : s;
  };

  // --------- Estado existente (conservado) ---------
  const [from, setFrom] = useState<string>('');
  const [to, setTo] = useState<string>('');
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // --------- NUEVO: datasets Fase D ---------
  const [ordersData, setOrdersData] = useState<OrderSnapshotLite[]>([]);
  const [tab, setTab] = useState<ReportTab>('lines');
  const [filters, setFilters] = useState<Filters>({
    jurisdiction: '',
    orderType: '',
    rateCode: '',
    b2bOnly: false,
  });

  // --------- NUEVO: Perfil activo ---------
  const [activeProfile, setActiveProfile] = useState<TaxProfile | null>(null);

  // Totales de tu tabla original
  const totalTax = useMemo(() => rows.reduce((a, r) => a + r.taxCents, 0), [rows]);
  const totalBase = useMemo(() => rows.reduce((a, r) => a + r.baseCents, 0), [rows]);
  const currency = rows[0]?.currency ?? 'USD';

  // Cargar perfil activo 1 vez 
// Cargar perfil activo 1 vez (tenant-aware real: tenants/{tenantId}/taxProfiles)
useEffect(() => {
  (async () => {
    if (!tenantId) return;
    try {
      // 1) Si tu helper ya soporta tenantId, úsalo:
      try {
        const pMaybe = await (getActiveTaxProfile as any)?.(tenantId);
        if (pMaybe) {
          setActiveProfile(pMaybe as TaxProfile);
          return;
        }
      } catch {
        // ignoramos y caemos al fallback directo a Firestore
      }

      // 2) Fallback: leer directo de Firestore en tenants/{tenantId}/taxProfiles
      //    criterio: activo primero, o el más reciente si no hay flag "active"
      const q = fsQuery(
        tCol('taxProfiles', tenantId),
        // si usas un campo "active: true", descomenta la línea de abajo:
        // where('active', '==', true),
        orderBy('createdAt', 'desc'),
        limit(1)
      );
      // claims frescos para evitar 403 por reglas recién cambiadas
      const u = getAuth().currentUser;
      if (u) await u.getIdToken(true);

      const snap = await getDocs(q);
      if (!snap.empty) {
        setActiveProfile(snap.docs[0].data() as TaxProfile);
      } else {
        setActiveProfile(null);
      }
    } catch {
      // no mostramos error duro en el panel, solo dejamos "No active profile found."
      setActiveProfile(null);
    }
  })();
}, [tenantId]);



  /* =========================
     RUN (tenant-aware)
     ========================= */
  const run = async () => {
  if (!from || !to) return alert(tt('admin.taxes.alert.pickRange', 'Pick a date range.'));
  const fromD = parseInputDate(from);
  const toD = parseInputDate(to);
  if (!fromD || !toD) return alert(tt('admin.taxes.alert.invalidDates', 'Invalid dates.'));
  try { await getAuth().currentUser?.getIdToken(true); } catch {}
  setLoading(true);
  setError(null);

  try {
    const qRef = fsQuery(
      tCol('orders', tenantId), // ✅ FIX: (colección, tenantId)
      where('status', '==', 'closed'),
      where('createdAt', '>=', Timestamp.fromDate(startOfDayLocal(fromD))),
      where('createdAt', '<=', Timestamp.fromDate(endOfDayLocal(toD))),
      orderBy('createdAt', 'asc'),
      limit(5000)
    );

    // 🔁 fuerza claims frescos en este tab antes de consultar Firestore
    const u = getAuth().currentUser;
    if (u) {
      await u.getIdToken(true);
    }

    const snap = await getDocs(qRef);

    // ... (resto idéntico a tu código: build de out/enriched, setRows, setOrdersData)


    const out: Row[] = [];
    const enriched: OrderSnapshotLite[] = [];

    snap.forEach(doc => {
      const d = doc.data() as any;
      const s = d.taxSnapshot as any | undefined;

      const createdAt =
        (d.createdAt && typeof d.createdAt.toDate === 'function')
          ? d.createdAt.toDate().toISOString().slice(0, 10)
          : (typeof d.createdAt === 'string'
              ? d.createdAt.slice(0, 10)
              : '');

      const currency = s?.currency || d.currency || 'USD';

      const orderType: '' | 'dine-in' | 'delivery' | 'pickup' =
        (d.orderType || d?.orderInfo?.type || '') as any;

      const jurisdictionApplied = safeStr(s?.jurisdictionApplied || '');

      const zeroBaseCents = cents(s?.summaryZeroRated?.baseCents);
      const exemptBaseCents = cents(s?.summaryExempt?.baseCents);

      // Surcharges (solo taxable)
      let serviceBaseCents = 0;
      let serviceTaxCents = 0;
      const surs = Array.isArray(s?.surcharges) ? s?.surcharges : [];
      for (const sc of surs) {
        if (sc?.taxable) {
          serviceBaseCents += cents(sc?.baseCents);
          serviceTaxCents += cents(sc?.taxCents);
        }
      }

      // Tabla original (por tasa)
      if (Array.isArray(s?.summaryByRate)) {
        for (const r of s.summaryByRate) {
          const hasBase = Number.isFinite(r?.baseCents);
          const baseCents = hasBase
            ? Number(r.baseCents || 0)
            : (Number.isFinite(r?.taxCents) && (Number(r?.rateBps) > 0)
                ? Math.round((Number(r.taxCents) * 10000) / Number(r.rateBps))
                : 0);

          const ratePct = Number.isFinite(r?.rateBps)
            ? (Number(r.rateBps) / 100)
            : Number(r?.ratePct ?? 0);

          out.push({
            date: createdAt,
            orderId: doc.id,
            taxCents: Number(r.taxCents || 0),
            baseCents,
            rateLabel: `${(ratePct).toFixed(2)}%`,
            currency,
          });
        }
      }

      // Totales por orden (para B2B)
      let orderTaxableBase = 0;
      let orderTax = 0;
      const linesForOrder = Array.isArray(s?.summaryByRate) ? s.summaryByRate : [];
      for (const r of linesForOrder) {
        const base = Number.isFinite(r?.baseCents)
          ? Number(r.baseCents || 0)
          : (Number.isFinite(r?.taxCents) && (Number(r?.rateBps) > 0)
              ? Math.round((Number(r.taxCents) * 10000) / Number(r.rateBps))
              : 0);
        orderTaxableBase += base;
        orderTax += cents(r?.taxCents);
      }
      orderTaxableBase += serviceBaseCents;
      orderTax += serviceTaxCents;

      const mappedRates = linesForOrder.map((r: any) => ({
        rateCode: safeStr(r?.rateCode || r?.code || ''),
        rateBps: Number.isFinite(r?.rateBps) ? Number(r.rateBps) : undefined,
        ratePct: Number.isFinite(r?.ratePct) ? Number(r.ratePct) : undefined,
        baseCents: Number.isFinite(r?.baseCents)
          ? Number(r.baseCents)
          : (Number.isFinite(r?.taxCents) && (Number(r?.rateBps) > 0)
              ? Math.round((Number(r.taxCents) * 10000) / Number(r.rateBps))
              : 0),
        taxCents: cents(r?.taxCents),
      }));

      const b2bTaxId =
        (d?.customer?.taxId && String(d.customer.taxId)) ||
        (s?.customer?.taxId && String(s.customer.taxId)) ||
        (d?.customerTaxId && String(d.customerTaxId)) ||
        null;

      enriched.push({
        id: doc.id,
        date: createdAt,
        currency,
        jurisdictionApplied,
        orderType,
        summaryByRate: mappedRates,
        zeroBaseCents,
        exemptBaseCents,
        serviceBaseCents,
        serviceTaxCents,
        b2bTaxId,
        orderTaxableBaseCents: orderTaxableBase,
        orderTaxCents: orderTax,
        orderTotalCents: cents(d?.totalsCents?.grandTotalWithTaxCents ?? d?.totalCents),
      });
    });

    setRows(out);
    setOrdersData(enriched);
  } catch (e: any) {
    const msg = e?.message || tt('common.loadError', 'Could not load data.');
    setError(msg);
    console.error('[TaxesReport] error:', e);
  } finally {
    setLoading(false);
  }
};


  /* =========================
     Filtros (en memoria)
     ========================= */
  const filteredOrders = useMemo(() => {
    return ordersData.filter(o => {
      if (filters.jurisdiction && (o.jurisdictionApplied || '').toLowerCase() !== filters.jurisdiction.toLowerCase()) {
        return false;
      }
      if (filters.orderType && o.orderType !== filters.orderType) {
        return false;
      }
      if (filters.b2bOnly && !(o.b2bTaxId && String(o.b2bTaxId).trim())) {
        return false;
      }
      if (filters.rateCode) {
        const rc = filters.rateCode.toLowerCase();
        const hit = o.summaryByRate.some(r => (r.rateCode || '').toLowerCase() === rc);
        if (!hit) return false;
      }
      return true;
    });
  }, [ordersData, filters]);

  /* =========================
     Aggregations
     ========================= */
  // 1) By Rate Summary
  const byRateSummary = useMemo(() => {
    const map = new Map<string, {
      jurisdictionApplied: string;
      orderType: string;
      rateCode: string;
      ratePct: number;
      taxableBaseCents: number;
      taxCents: number;
      zeroRatedBaseCents: number;
      exemptBaseCents: number;
      serviceBaseCents: number;
      serviceTaxCents: number;
      currency: string;
    }>();

    for (const o of filteredOrders) {
      const curr = o.currency || 'USD';
      for (const r of o.summaryByRate) {
        const pct = Number.isFinite(r.rateBps)
          ? (Number(r.rateBps) / 100)
          : Number(r.ratePct ?? 0);
        const key = [o.jurisdictionApplied, o.orderType, r.rateCode || '', pct.toFixed(6), curr].join('|');
        const prev = map.get(key) || {
          jurisdictionApplied: o.jurisdictionApplied,
          orderType: o.orderType,
          rateCode: r.rateCode || '',
          ratePct: pct,
          taxableBaseCents: 0,
          taxCents: 0,
          zeroRatedBaseCents: 0,
          exemptBaseCents: 0,
          serviceBaseCents: 0,
          serviceTaxCents: 0,
          currency: curr,
        };
        prev.taxableBaseCents += cents(r.baseCents);
        prev.taxCents += cents(r.taxCents);
        map.set(key, prev);
      }
      // zero/exempt
      if (o.zeroBaseCents || o.exemptBaseCents) {
        const key = [o.jurisdictionApplied, o.orderType, '', '0.000000', o.currency].join('|');
        const prev = map.get(key) || {
          jurisdictionApplied: o.jurisdictionApplied,
          orderType: o.orderType,
          rateCode: '',
          ratePct: 0,
          taxableBaseCents: 0,
          taxCents: 0,
          zeroRatedBaseCents: 0,
          exemptBaseCents: 0,
          serviceBaseCents: 0,
          serviceTaxCents: 0,
          currency: o.currency,
        };
        prev.zeroRatedBaseCents += cents(o.zeroBaseCents);
        prev.exemptBaseCents += cents(o.exemptBaseCents);
        map.set(key, prev);
      }
      // service charge taxable
      if (o.serviceBaseCents || o.serviceTaxCents) {
        const key = [o.jurisdictionApplied, o.orderType, 'service', '0.000000', o.currency].join('|');
        const prev = map.get(key) || {
          jurisdictionApplied: o.jurisdictionApplied,
          orderType: o.orderType,
          rateCode: 'service',
          ratePct: 0,
          taxableBaseCents: 0,
          taxCents: 0,
          zeroRatedBaseCents: 0,
          exemptBaseCents: 0,
          serviceBaseCents: 0,
          serviceTaxCents: 0,
          currency: o.currency,
        };
        prev.serviceBaseCents += cents(o.serviceBaseCents);
        prev.serviceTaxCents += cents(o.serviceTaxCents);
        map.set(key, prev);
      }
    }

    const rows = Array.from(map.values()).sort((a, b) => {
      if (a.jurisdictionApplied !== b.jurisdictionApplied)
        return a.jurisdictionApplied.localeCompare(b.jurisdictionApplied);
      if (a.orderType !== b.orderType) return a.orderType.localeCompare(b.orderType);
      if (a.rateCode !== b.rateCode) return a.rateCode.localeCompare(b.rateCode);
      return a.ratePct - b.ratePct;
    });
    return rows;
  }, [filteredOrders]);

  // 2) VAT Book (Sales)
  const vatBook = useMemo(() => {
    const map = new Map<string, {
      jurisdictionApplied: string;
      rateCode: string;
      ratePct: number;
      taxableBaseCents: number;
      taxCents: number;
      zeroRatedBaseCents: number;
      exemptBaseCents: number;
      currency: string;
    }>();

    for (const o of filteredOrders) {
      const curr = o.currency || 'USD';
      for (const r of o.summaryByRate) {
        const pct = Number.isFinite(r.rateBps)
          ? (Number(r.rateBps) / 100)
          : Number(r.ratePct ?? 0);
        const key = [o.jurisdictionApplied, r.rateCode || '', pct.toFixed(6), curr].join('|');
        const prev = map.get(key) || {
          jurisdictionApplied: o.jurisdictionApplied,
          rateCode: r.rateCode || '',
          ratePct: pct,
          taxableBaseCents: 0,
          taxCents: 0,
          zeroRatedBaseCents: 0,
          exemptBaseCents: 0,
          currency: curr,
        };
        prev.taxableBaseCents += cents(r.baseCents);
        prev.taxCents += cents(r.taxCents);
        map.set(key, prev);
      }
      if (o.zeroBaseCents) {
        const key = [o.jurisdictionApplied, 'ZERO', '0.000000', o.currency].join('|');
        const prev = map.get(key) || {
          jurisdictionApplied: o.jurisdictionApplied,
          rateCode: 'ZERO',
          ratePct: 0,
          taxableBaseCents: 0,
          taxCents: 0,
          zeroRatedBaseCents: 0,
          exemptBaseCents: 0,
          currency: o.currency,
        };
        prev.zeroRatedBaseCents += cents(o.zeroBaseCents);
        map.set(key, prev);
      }
      if (o.exemptBaseCents) {
        const key = [o.jurisdictionApplied, 'EXEMPT', '0.000000', o.currency].join('|');
        const prev = map.get(key) || {
          jurisdictionApplied: o.jurisdictionApplied,
          rateCode: 'EXEMPT',
          ratePct: 0,
          taxableBaseCents: 0,
          taxCents: 0,
          zeroRatedBaseCents: 0,
          exemptBaseCents: 0,
          currency: o.currency,
        };
        prev.exemptBaseCents += cents(o.exemptBaseCents);
        map.set(key, prev);
      }
    }

    const rows = Array.from(map.values()).sort((a, b) => {
      if (a.jurisdictionApplied !== b.jurisdictionApplied)
        return a.jurisdictionApplied.localeCompare(b.jurisdictionApplied);
      if (a.rateCode !== b.rateCode) return a.rateCode.localeCompare(b.rateCode);
      return a.ratePct - b.ratePct;
    });
    return rows;
  }, [filteredOrders]);

  // 3) B2B Register
  const b2bRows = useMemo(() => {
    const out = filteredOrders
      .filter(o => !!(o.b2bTaxId && String(o.b2bTaxId).trim()))
      .map(o => ({
        date: o.date,
        orderId: o.id,
        invoiceNumber: safeStr((o as any).invoiceNumber || ''),
        customerName: safeStr((o as any)?.customer?.name || ''),
        customerTaxId: safeStr(o.b2bTaxId),
        jurisdictionApplied: o.jurisdictionApplied,
        orderType: o.orderType,
        taxableBaseCents: cents(o.orderTaxableBaseCents),
        taxCents: cents(o.orderTaxCents),
        totalCents: cents(o.orderTotalCents),
        currency: o.currency || 'USD',
      }));
    return out.sort((a, b) => (a.date !== b.date ? a.date.localeCompare(b.date) : a.orderId.localeCompare(b.orderId)));
  }, [filteredOrders]);

  /* =========================
     CSV exports (por pestaña actual)
     ========================= */
  const exportCsvLines = () => {
    const header = [
      tt('admin.taxes.csv.date', 'Date'),
      tt('admin.taxes.csv.orderId', 'Order ID'),
      tt('admin.taxes.csv.rate', 'Rate'),
      tt('admin.taxes.csv.base', 'Base'),
      tt('admin.taxes.csv.tax', 'Tax'),
      tt('admin.taxes.csv.currency', 'Currency'),
    ];
    const lines = rows.map(r =>
      [
        r.date,
        r.orderId,
        r.rateLabel,
        (r.baseCents/100).toFixed(2),
        (r.taxCents/100).toFixed(2),
        r.currency
      ].join(',')
    );
    const blob = new Blob([header.join(',')+'\n'+lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    saveAs(blob, `taxes_${from}_${to}.csv`);
  };

  const exportCsvSummary = () => {
    const header = [
      tt('admin.taxes.csv.jurisdiction', 'Jurisdiction'),
      tt('admin.taxes.csv.orderType', 'Order Type'),
      tt('admin.taxes.csv.rateCode', 'Rate Code'),
      tt('admin.taxes.csv.ratePct', 'Rate %'),
      tt('admin.taxes.csv.taxableBase', 'Taxable Base'),
      tt('admin.taxes.csv.vat', 'VAT'),
      tt('admin.taxes.csv.zeroBase', 'Zero-Rated Base'),
      tt('admin.taxes.csv.exemptBase', 'Exempt Base'),
      tt('admin.taxes.csv.serviceBase', 'Service Base'),
      tt('admin.taxes.csv.serviceVat', 'Service VAT'),
      tt('admin.taxes.csv.currency', 'Currency'),
    ];
    const lines = byRateSummary.map(r => [
      r.jurisdictionApplied,
      r.orderType || '—',
      r.rateCode || '—',
      (r.ratePct ?? 0).toString(),
      (r.taxableBaseCents/100).toFixed(2),
      (r.taxCents/100).toFixed(2),
      (r.zeroRatedBaseCents/100).toFixed(2),
      (r.exemptBaseCents/100).toFixed(2),
      (r.serviceBaseCents/100).toFixed(2),
      (r.serviceTaxCents/100).toFixed(2),
      r.currency,
    ].join(','));
    const blob = new Blob([header.join(',')+'\n'+lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    saveAs(blob, `by_rate_summary_${from}_${to}.csv`);
  };

  const exportCsvVatBook = () => {
    const header = [
      tt('admin.taxes.csv.jurisdiction', 'Jurisdiction'),
      tt('admin.taxes.csv.rateCode', 'Rate Code'),
      tt('admin.taxes.csv.ratePct', 'Rate %'),
      tt('admin.taxes.csv.taxableBase', 'Taxable Base'),
      tt('admin.taxes.csv.vat', 'VAT'),
      tt('admin.taxes.csv.zeroBase', 'Zero-Rated Base'),
      tt('admin.taxes.csv.exemptBase', 'Exempt Base'),
      tt('admin.taxes.csv.currency', 'Currency'),
    ];
    const lines = vatBook.map(r => [
      r.jurisdictionApplied,
      r.rateCode,
      (r.ratePct ?? 0).toString(),
      (r.taxableBaseCents/100).toFixed(2),
      (r.taxCents/100).toFixed(2),
      (r.zeroRatedBaseCents/100).toFixed(2),
      (r.exemptBaseCents/100).toFixed(2),
      r.currency,
    ].join(','));
    const blob = new Blob([header.join(',')+'\n'+lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    saveAs(blob, `vat_book_${from}_${to}.csv`);
  };

  const exportCsvB2B = () => {
    const header = [
      tt('admin.taxes.csv.date', 'Date'),
      tt('admin.taxes.csv.invoice', 'Invoice #'),
      tt('admin.taxes.csv.orderId', 'Order ID'),
      tt('admin.taxes.csv.customer', 'Customer'),
      tt('admin.taxes.csv.taxId', 'Tax ID'),
      tt('admin.taxes.csv.jurisdiction', 'Jurisdiction'),
      tt('admin.taxes.csv.orderType', 'Order Type'),
      tt('admin.taxes.csv.taxableBase', 'Taxable Base'),
      tt('admin.taxes.csv.vat', 'VAT'),
      tt('admin.taxes.csv.total', 'Total'),
      tt('admin.taxes.csv.currency', 'Currency'),
    ];
    const lines = b2bRows.map(r => [
      r.date,
      r.invoiceNumber || '',
      r.orderId,
      r.customerName,
      r.customerTaxId,
      r.jurisdictionApplied || '—',
      r.orderType || '—',
      (r.taxableBaseCents/100).toFixed(2),
      (r.taxCents/100).toFixed(2),
      (r.totalCents/100).toFixed(2),
      r.currency,
    ].join(','));
    const blob = new Blob([header.join(',')+'\n'+lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    saveAs(blob, `b2b_register_${from}_${to}.csv`);
  };

  const exportCurrent = () => {
    if (tab === 'lines') return exportCsvLines();
    if (tab === 'summary') return exportCsvSummary();
    if (tab === 'vatbook') return exportCsvVatBook();
    if (tab === 'b2b') return exportCsvB2B();
  };

  /* =========================
     EXCEL (multi-sheet) con ExcelJS
     ========================= */
  const exportExcelAll = async () => {
    if (!rows.length && !byRateSummary.length && !vatBook.length && !b2bRows.length && !activeProfile) {
      alert(tt('admin.taxes.alert.runFirst', 'Run the report first.'));
      return;
    }

    const ExcelJS = (await import('exceljs')).default;

    const wb = new ExcelJS.Workbook();
    wb.creator = 'Restaurante Admin';
    wb.created = new Date();

    const toMoney = (centsVal: number) => (centsVal ?? 0) / 100;
    const MONEY_FMT = '#,##0.00';
    const PERCENT_FMT = '0.00';

    const sanitizeCell = (v: any) => {
      if (typeof v === 'string' && /^[=+\-@]/.test(v)) return `'${v}`;
      return v;
    };

    const addSheet = (
      title: string,
      headers: Array<{ key: string; header: string; width?: number; numFmt?: string }>,
      data: any[],
    ) => {
      const ws = wb.addWorksheet(title);
      ws.columns = headers.map(h => ({
        key: h.key,
        header: h.header,
        width: h.width ?? 16,
        style: h.numFmt ? { numFmt: h.numFmt } : {},
      }));
      ws.getRow(1).font = { bold: true };

      data.forEach(obj => {
        const row: any = {};
        headers.forEach(h => {
          row[h.key] = sanitizeCell(obj[h.key]);
        });
        ws.addRow(row);
      });

      headers.forEach((h, idx) => {
        if (!h.numFmt) return;
        const col = ws.getColumn(idx + 1);
        col.eachCell((cell, rowNumber) => {
          if (rowNumber === 1) return;
          if (typeof cell.value === 'number') {
            cell.numFmt = h.numFmt!;
          }
        });
      });

      return ws;
    };

    // 1) Summary_By_Rate
    if (byRateSummary.length) {
      addSheet(
        tt('admin.taxes.xls.sheet.summary', 'Summary_By_Rate'),
        [
          { key: 'jurisdictionApplied', header: tt('admin.taxes.xls.jurisdiction', 'Jurisdiction'), width: 20 },
          { key: 'orderType', header: tt('admin.taxes.xls.orderType', 'OrderType'), width: 12 },
          { key: 'rateCode', header: tt('admin.taxes.xls.rateCode', 'RateCode'), width: 14 },
          { key: 'ratePct', header: tt('admin.taxes.xls.ratePct', 'Rate%'), width: 8, numFmt: PERCENT_FMT },
          { key: 'taxableBase', header: tt('admin.taxes.xls.taxableBase', 'TaxableBase'), numFmt: MONEY_FMT },
          { key: 'vat', header: tt('admin.taxes.xls.vat', 'VAT'), numFmt: MONEY_FMT },
          { key: 'zeroBase', header: tt('admin.taxes.xls.zeroBase', 'ZeroRatedBase'), numFmt: MONEY_FMT },
          { key: 'exemptBase', header: tt('admin.taxes.xls.exemptBase', 'ExemptBase'), numFmt: MONEY_FMT },
          { key: 'serviceBase', header: tt('admin.taxes.xls.serviceBase', 'ServiceBase'), numFmt: MONEY_FMT },
          { key: 'serviceVat', header: tt('admin.taxes.xls.serviceVat', 'ServiceVAT'), numFmt: MONEY_FMT },
          { key: 'currency', header: tt('admin.taxes.xls.currency', 'Currency'), width: 10 },
        ],
        byRateSummary.map(r => ({
          jurisdictionApplied: r.jurisdictionApplied || '—',
          orderType: r.orderType || '—',
          rateCode: r.rateCode || '—',
          ratePct: Number(r.ratePct ?? 0),
          taxableBase: toMoney(r.taxableBaseCents),
          vat: toMoney(r.taxCents),
          zeroBase: toMoney(r.zeroRatedBaseCents),
          exemptBase: toMoney(r.exemptBaseCents),
          serviceBase: toMoney(r.serviceBaseCents),
          serviceVat: toMoney(r.serviceTaxCents),
          currency: r.currency || '',
        }))
      );
    }

    // 2) VAT_Book_Sales
    if (vatBook.length) {
      addSheet(
        tt('admin.taxes.xls.sheet.vatbook', 'VAT_Book_Sales'),
        [
          { key: 'jurisdictionApplied', header: tt('admin.taxes.xls.jurisdiction', 'Jurisdiction'), width: 20 },
          { key: 'rateCode', header: tt('admin.taxes.xls.rateCode', 'RateCode'), width: 14 },
          { key: 'ratePct', header: tt('admin.taxes.xls.ratePct', 'Rate%'), width: 8, numFmt: PERCENT_FMT },
          { key: 'taxableBase', header: tt('admin.taxes.xls.taxableBase', 'TaxableBase'), numFmt: MONEY_FMT },
          { key: 'vat', header: tt('admin.taxes.xls.vat', 'VAT'), numFmt: MONEY_FMT },
          { key: 'zeroBase', header: tt('admin.taxes.xls.zeroBase', 'ZeroRatedBase'), numFmt: MONEY_FMT },
          { key: 'exemptBase', header: tt('admin.taxes.xls.exemptBase', 'ExemptBase'), numFmt: MONEY_FMT },
          { key: 'currency', header: tt('admin.taxes.xls.currency', 'Currency'), width: 10 },
        ],
        vatBook.map(r => ({
          jurisdictionApplied: r.jurisdictionApplied || '—',
          rateCode: r.rateCode,
          ratePct: Number(r.ratePct ?? 0),
          taxableBase: toMoney(r.taxableBaseCents),
          vat: toMoney(r.taxCents),
          zeroBase: toMoney(r.zeroRatedBaseCents),
          exemptBase: toMoney(r.exemptBaseCents),
          currency: r.currency || '',
        }))
      );
    }

    // 3) B2B_Register
    if (b2bRows.length) {
      addSheet(
        tt('admin.taxes.xls.sheet.b2b', 'B2B_Register'),
        [
          { key: 'date', header: tt('admin.taxes.xls.date', 'Date'), width: 12 },
          { key: 'invoiceNumber', header: tt('admin.taxes.xls.invoice', 'Invoice'), width: 16 },
          { key: 'orderId', header: tt('admin.taxes.xls.orderId', 'OrderId'), width: 18 },
          { key: 'customerName', header: tt('admin.taxes.xls.customer', 'Customer'), width: 24 },
          { key: 'customerTaxId', header: tt('admin.taxes.xls.taxId', 'TaxID'), width: 18 },
          { key: 'jurisdictionApplied', header: tt('admin.taxes.xls.jurisdiction', 'Jurisdiction'), width: 20 },
          { key: 'orderType', header: tt('admin.taxes.xls.orderType', 'OrderType'), width: 12 },
          { key: 'taxableBase', header: tt('admin.taxes.xls.taxableBase', 'TaxableBase'), numFmt: MONEY_FMT },
          { key: 'vat', header: tt('admin.taxes.xls.vat', 'VAT'), numFmt: MONEY_FMT },
          { key: 'total', header: tt('admin.taxes.xls.total', 'Total'), numFmt: MONEY_FMT },
          { key: 'currency', header: tt('admin.taxes.xls.currency', 'Currency'), width: 10 },
        ],
        b2bRows.map(r => ({
          date: r.date,
          invoiceNumber: r.invoiceNumber || '',
          orderId: r.orderId,
          customerName: r.customerName || '',
          customerTaxId: r.customerTaxId || '',
          jurisdictionApplied: r.jurisdictionApplied || '—',
          orderType: r.orderType || '—',
          taxableBase: toMoney(r.taxableBaseCents),
          vat: toMoney(r.taxCents),
          total: toMoney(r.totalCents),
          currency: r.currency || '',
        }))
      );
    }

    // 4) Legacy_Simple (tu reporte original)
    if (rows.length) {
      addSheet(
        tt('admin.taxes.xls.sheet.legacy', 'Legacy_Simple'),
        [
          { key: 'date', header: tt('admin.taxes.xls.date', 'Date'), width: 12 },
          { key: 'orderId', header: tt('admin.taxes.xls.orderId', 'OrderId'), width: 18 },
          { key: 'rateLabel', header: tt('admin.taxes.xls.rate', 'Rate'), width: 10 },
          { key: 'base', header: tt('admin.taxes.xls.base', 'Base'), numFmt: MONEY_FMT },
          { key: 'tax', header: tt('admin.taxes.xls.tax', 'Tax'), numFmt: MONEY_FMT },
          { key: 'currency', header: tt('admin.taxes.xls.currency', 'Currency'), width: 10 },
        ],
        rows.map(r => ({
          date: r.date,
          orderId: r.orderId,
          rateLabel: r.rateLabel,
          base: toMoney(r.baseCents),
          tax: toMoney(r.taxCents),
          currency: r.currency,
        }))
      );
    }

    // 5) Tax_Profile
    if (activeProfile) {
      const p = activeProfile;
      const service = Array.isArray(p.surcharges) ? p.surcharges[0] : null;
      const ws = wb.addWorksheet(tt('admin.taxes.xls.sheet.profile', 'Tax_Profile'));
      ws.addRow([tt('admin.taxes.xls.kv.key', 'Key'), tt('admin.taxes.xls.kv.value', 'Value')]).font = { bold: true };
      const kv: Array<[string, any]> = [
        [tt('admin.taxes.profile.country', 'Country'), String(p.country || 'GT')],
        [tt('admin.taxes.profile.currency', 'Currency'), String(p.currency || 'USD')],
        [tt('admin.taxes.profile.pricesIncl', 'Prices include tax'), String(!!p.pricesIncludeTax)],
        [tt('admin.taxes.profile.rounding', 'Rounding'), String(p.rounding || 'half_up')],
        ['Delivery.mode', p?.delivery?.mode || 'out_of_scope'],
        ['Delivery.taxable', String(!!p?.delivery?.taxable)],
        ['Delivery.taxCode', p?.delivery?.taxCode || ''],
        [tt('admin.taxes.profile.servicePct', 'Service percent%'), service ? (service.percentBps || 0)/100 : 0],
        [tt('admin.taxes.profile.serviceTaxable', 'Service taxable'), service ? String(!!service.taxable) : 'false'],
        [tt('admin.taxes.profile.serviceCode', 'Service tax code'), service?.taxCode || ''],
        [tt('admin.taxes.profile.ratesCount', 'Rates.count'), Array.isArray(p.rates) ? p.rates.length : 0],
      ];
      for (const [k,v] of kv) ws.addRow([k, v]);
      ws.getColumn(1).width = 24;
      ws.getColumn(2).width = 28;
    }

    // 6) Report_Params
    {
      const totals = {
        legacyBase: rows.reduce((a,r)=>a+(r.baseCents||0),0),
        legacyTax: rows.reduce((a,r)=>a+(r.taxCents||0),0),
        summaryTaxable: byRateSummary.reduce((a,r)=>a+(r.taxableBaseCents||0),0),
        summaryTax: byRateSummary.reduce((a,r)=>a+(r.taxCents||0),0),
      };
      const ws = wb.addWorksheet(tt('admin.taxes.xls.sheet.params', 'Report_Params'));
      ws.addRow([tt('admin.taxes.xls.kv.param', 'Param'), tt('admin.taxes.xls.kv.value', 'Value')]).font = { bold: true };
      const params: Array<[string, any]> = [
        [tt('admin.taxes.params.from', 'From'), from || ''],
        [tt('admin.taxes.params.to', 'To'), to || ''],
        [tt('admin.taxes.params.generatedAt', 'GeneratedAt'), new Date().toISOString()],
        ['Legacy.TotalBase', (totals.legacyBase/100)],
        ['Legacy.TotalTax', (totals.legacyTax/100)],
        ['Summary.TotalTaxableBase', (totals.summaryTaxable/100)],
        ['Summary.TotalVAT', (totals.summaryTax/100)],
        ['Filters.jurisdiction', filters.jurisdiction || ''],
        ['Filters.orderType', filters.orderType || ''],
        ['Filters.rateCode', filters.rateCode || ''],
        ['Filters.b2bOnly', String(!!filters.b2bOnly)],
      ];
      for (const [k,v] of params) ws.addRow([k, typeof v === 'number' ? v : v]);
      ws.getColumn(1).width = 22;
      ws.getColumn(2).width = 42;
      ws.getColumn(2).eachCell((cell, rowNumber) => {
        if (rowNumber === 1) return;
        if (typeof cell.value === 'number') cell.numFmt = MONEY_FMT;
      });
    }

    const buffer = await wb.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    saveAs(blob, `tax_reports_${from}_${to}.xlsx`);
  };

  return (
    <Protected>
      <AdminOnly>
        <ToolGate feature="taxesReports">
          <main className="container py-4">
            <div className="d-flex align-items-center justify-content-between mb-3">
              <h1 className="h4 m-0">{tt('admin.taxes.title', 'Tax reports')}</h1>

              {/* Panel de filtros y acciones */}
              <div className="d-flex flex-wrap gap-2 align-items-center">
                {/* Rango de fechas (conservado) */}
                <input type="date" className="form-control" value={from} onChange={e => setFrom(e.target.value)} />
                <input type="date" className="form-control" value={to} onChange={e => setTo(e.target.value)} />

                {/* NUEVOS filtros */}
                <input
                  className="form-control"
                  placeholder={tt('admin.taxes.filters.jurisdictionPh', 'Jurisdiction')}
                  value={filters.jurisdiction}
                  onChange={(e) => setFilters((f) => ({ ...f, jurisdiction: e.target.value }))}
                  style={{ minWidth: 160 }}
                  title={tt('admin.taxes.filters.jurisdictionTitle', 'Exact jurisdictionApplied')}
                />
                <select
                  className="form-select"
                  value={filters.orderType}
                  onChange={(e) => setFilters((f) => ({ ...f, orderType: e.target.value as Filters['orderType'] }))}
                  style={{ minWidth: 140 }}
                  title={tt('admin.taxes.filters.orderTypeTitle', 'Order type')}
                >
                  <option value="">{tt('admin.taxes.filters.allTypes', 'All types')}</option>
                  <option value="dine-in">{tt('admin.taxes.filters.dinein', 'Dine-in')}</option>
                  <option value="pickup">{tt('admin.taxes.filters.pickup', 'Pickup')}</option>
                  <option value="delivery">{tt('admin.taxes.filters.delivery', 'Delivery')}</option>
                </select>
                <input
                  className="form-control"
                  placeholder={tt('admin.taxes.filters.rateCodePh', 'Rate code (e.g., std)')}
                  value={filters.rateCode}
                  onChange={(e) => setFilters((f) => ({ ...f, rateCode: e.target.value }))}
                  style={{ minWidth: 160 }}
                  title={tt('admin.taxes.filters.rateCodeTitle', 'rateCode')}
                />
                <label className="d-flex align-items-center gap-2 ms-1">
                  <input
                    type="checkbox"
                    className="form-check-input"
                    checked={filters.b2bOnly}
                    onChange={(e) => setFilters((f) => ({ ...f, b2bOnly: e.target.checked }))}
                  />
                  <span className="small">{tt('admin.taxes.filters.onlyB2B', 'Only B2B')}</span>
                </label>

                {/* Acciones */}
                <button className="btn btn-outline-primary" onClick={run} disabled={loading}>
                  {loading ? tt('common.loading', 'Loading…') : tt('admin.taxes.actions.run', 'Run')}
                </button>
                <button className="btn btn-primary" onClick={exportCurrent} disabled={loading}>
                  {tt('admin.taxes.actions.exportCsv', 'Export CSV')}
                </button>
                <button
                  className="btn btn-success"
                  onClick={exportExcelAll}
                  disabled={loading || (!rows.length && !byRateSummary.length && !vatBook.length && !b2bRows.length && !activeProfile)}
                  title={tt('admin.taxes.actions.exportExcelTitle', 'Export multi-sheet Excel (Summary, VAT Book, B2B, Legacy, Tax Profile, Params)')}
                >
                  {tt('admin.taxes.actions.exportExcel', 'Export Excel')}
                </button>
              </div>
            </div>

            {/* Alertas */}
            {error && (
              <div className="alert alert-warning">
                {error}
                <div className="small text-muted mt-1">
                  {tt('admin.taxes.alert.indexTip', 'If Firestore asks for an index, use the console link (status==closed + createdAt asc).')}
                </div>
              </div>
            )}

            <div className="row g-3">
              {/* Columna principal: pestañas de reportes */}
              <div className="col-12 col-lg-8">
                {/* Tabs */}
                <ul className="nav nav-tabs mb-3">
                  <li className="nav-item">
                    <button className={`nav-link ${tab==='lines'?'active':''}`} onClick={() => setTab('lines')}>
                      {tt('admin.taxes.tabs.lines', 'Lines (as-is)')}
                    </button>
                  </li>
                  <li className="nav-item">
                    <button className={`nav-link ${tab==='summary'?'active':''}`} onClick={() => setTab('summary')}>
                      {tt('admin.taxes.tabs.summary', 'By Rate Summary')}
                    </button>
                  </li>
                  <li className="nav-item">
                    <button className={`nav-link ${tab==='vatbook'?'active':''}`} onClick={() => setTab('vatbook')}>
                      {tt('admin.taxes.tabs.vatbook', 'VAT Book (Sales)')}
                    </button>
                  </li>
                  <li className="nav-item">
                    <button className={`nav-link ${tab==='b2b'?'active':''}`} onClick={() => setTab('b2b')}>
                      {tt('admin.taxes.tabs.b2b', 'B2B Register')}
                    </button>
                  </li>
                </ul>

                {/* Tabla Lines */}
                {tab === 'lines' && (
                  <div className="card shadow-sm">
                    <div className="card-body">
                      <div className="table-responsive">
                        <table className="table table-sm align-middle">
                          <thead>
                            <tr>
                              <th>{tt('admin.taxes.lines.th.date', 'Date')}</th>
                              <th>{tt('admin.taxes.lines.th.order', 'Order')}</th>
                              <th>{tt('admin.taxes.lines.th.rate', 'Rate')}</th>
                              <th className="text-end">{tt('admin.taxes.lines.th.base', 'Base')}</th>
                              <th className="text-end">{tt('admin.taxes.lines.th.tax', 'Tax')}</th>
                              <th>{tt('admin.taxes.lines.th.currency', 'Currency')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {rows.map((r, i) => (
                              <tr key={i}>
                                <td>{r.date}</td>
                                <td>{r.orderId}</td>
                                <td>{r.rateLabel}</td>
                                <td className="text-end">{fmtMoneyCents(r.baseCents, r.currency)}</td>
                                <td className="text-end">{fmtMoneyCents(r.taxCents, r.currency)}</td>
                                <td>{r.currency}</td>
                              </tr>
                            ))}
                            {!rows.length && !loading && (
                              <tr>
                                <td colSpan={6} className="text-center text-muted py-4">{tt('common.nodata', 'No data')}</td>
                              </tr>
                            )}
                          </tbody>
                          {rows.length > 0 && (
                            <tfoot>
                              <tr className="fw-semibold">
                                <td colSpan={3} className="text-end">{tt('admin.taxes.lines.totals', 'Totals')}</td>
                                <td className="text-end">{fmtMoneyCents(totalBase, currency)}</td>
                                <td className="text-end">{fmtMoneyCents(totalTax, currency)}</td>
                                <td>{currency}</td>
                              </tr>
                            </tfoot>
                          )}
                        </table>
                      </div>
                    </div>
                  </div>
                )}

                {/* Tabla By Rate Summary */}
                {tab === 'summary' && (
                  <div className="card shadow-sm">
                    <div className="card-body">
                      <div className="table-responsive">
                        <table className="table table-sm table-striped align-middle">
                          <thead>
                            <tr>
                              <th>{tt('admin.taxes.summary.th.jurisdiction', 'Jurisdiction')}</th>
                              <th>{tt('admin.taxes.summary.th.orderType', 'Order Type')}</th>
                              <th>{tt('admin.taxes.summary.th.rateCode', 'Rate Code')}</th>
                              <th className="text-end">{tt('admin.taxes.summary.th.ratePct', 'Rate %')}</th>
                              <th className="text-end">{tt('admin.taxes.summary.th.taxableBase', 'Taxable Base')}</th>
                              <th className="text-end">{tt('admin.taxes.summary.th.vat', 'VAT')}</th>
                              <th className="text-end">{tt('admin.taxes.summary.th.zeroBase', 'Zero-Rated Base')}</th>
                              <th className="text-end">{tt('admin.taxes.summary.th.exemptBase', 'Exempt Base')}</th>
                              <th className="text-end">{tt('admin.taxes.summary.th.serviceBase', 'Service Base')}</th>
                              <th className="text-end">{tt('admin.taxes.summary.th.serviceVat', 'Service VAT')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {byRateSummary.map((r, i) => (
                              <tr key={i}>
                                <td>{r.jurisdictionApplied || '—'}</td>
                                <td>{r.orderType || '—'}</td>
                                <td>{r.rateCode || '—'}</td>
                                <td className="text-end">{(r.ratePct ?? 0).toFixed(2)}</td>
                                <td className="text-end">{fmtMoneyCents(r.taxableBaseCents, r.currency)}</td>
                                <td className="text-end">{fmtMoneyCents(r.taxCents, r.currency)}</td>
                                <td className="text-end">{fmtMoneyCents(r.zeroRatedBaseCents, r.currency)}</td>
                                <td className="text-end">{fmtMoneyCents(r.exemptBaseCents, r.currency)}</td>
                                <td className="text-end">{fmtMoneyCents(r.serviceBaseCents, r.currency)}</td>
                                <td className="text-end">{fmtMoneyCents(r.serviceTaxCents, r.currency)}</td>
                              </tr>
                            ))}
                            {!byRateSummary.length && !loading && (
                              <tr>
                                <td colSpan={10} className="text-center text-muted py-4">{tt('common.nodata', 'No data')}</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}

                {/* Tabla VAT Book */}
                {tab === 'vatbook' && (
                  <div className="card shadow-sm">
                    <div className="card-body">
                      <div className="table-responsive">
                        <table className="table table-sm table-striped align-middle">
                          <thead>
                            <tr>
                              <th>{tt('admin.taxes.vatbook.th.jurisdiction', 'Jurisdiction')}</th>
                              <th>{tt('admin.taxes.vatbook.th.rateCode', 'Rate Code')}</th>
                              <th className="text-end">{tt('admin.taxes.vatbook.th.ratePct', 'Rate %')}</th>
                              <th className="text-end">{tt('admin.taxes.vatbook.th.taxableBase', 'Taxable Base')}</th>
                              <th className="text-end">{tt('admin.taxes.vatbook.th.vat', 'VAT')}</th>
                              <th className="text-end">{tt('admin.taxes.vatbook.th.zeroBase', 'Zero-Rated Base')}</th>
                              <th className="text-end">{tt('admin.taxes.vatbook.th.exemptBase', 'Exempt Base')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {vatBook.map((r, i) => (
                              <tr key={i}>
                                <td>{r.jurisdictionApplied || '—'}</td>
                                <td>{r.rateCode}</td>
                                <td className="text-end">{(r.ratePct ?? 0).toFixed(2)}</td>
                                <td className="text-end">{fmtMoneyCents(r.taxableBaseCents, r.currency)}</td>
                                <td className="text-end">{fmtMoneyCents(r.taxCents, r.currency)}</td>
                                <td className="text-end">{fmtMoneyCents(r.zeroRatedBaseCents, r.currency)}</td>
                                <td className="text-end">{fmtMoneyCents(r.exemptBaseCents, r.currency)}</td>
                              </tr>
                            ))}
                            {!vatBook.length && !loading && (
                              <tr>
                                <td colSpan={7} className="text-center text-muted py-4">{tt('common.nodata', 'No data')}</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}

                {/* Tabla B2B */}
                {tab === 'b2b' && (
                  <div className="card shadow-sm">
                    <div className="card-body">
                      <div className="table-responsive">
                        <table className="table table-sm table-striped align-middle">
                          <thead>
                            <tr>
                              <th>{tt('admin.taxes.b2b.th.date', 'Date')}</th>
                              <th>{tt('admin.taxes.b2b.th.invoice', 'Invoice #')}</th>
                              <th>{tt('admin.taxes.b2b.th.orderId', 'Order ID')}</th>
                              <th>{tt('admin.taxes.b2b.th.customer', 'Customer')}</th>
                              <th>{tt('admin.taxes.b2b.th.taxId', 'Tax ID')}</th>
                              <th>{tt('admin.taxes.b2b.th.jurisdiction', 'Jurisdiction')}</th>
                              <th>{tt('admin.taxes.b2b.th.orderType', 'Order Type')}</th>
                              <th className="text-end">{tt('admin.taxes.b2b.th.taxableBase', 'Taxable Base')}</th>
                              <th className="text-end">{tt('admin.taxes.b2b.th.vat', 'VAT')}</th>
                              <th className="text-end">{tt('admin.taxes.b2b.th.total', 'Total')}</th>
                            </tr>
                          </thead>
                          <tbody>
                            {b2bRows.map((r, i) => (
                              <tr key={i}>
                                <td>{r.date}</td>
                                <td>{r.invoiceNumber}</td>
                                <td>{r.orderId}</td>
                                <td>{r.customerName}</td>
                                <td>{r.customerTaxId}</td>
                                <td>{r.jurisdictionApplied || '—'}</td>
                                <td>{r.orderType || '—'}</td>
                                <td className="text-end">{fmtMoneyCents(r.taxableBaseCents, r.currency)}</td>
                                <td className="text-end">{fmtMoneyCents(r.taxCents, r.currency)}</td>
                                <td className="text-end">{fmtMoneyCents(r.totalCents, r.currency)}</td>
                              </tr>
                            ))}
                            {!b2bRows.length && !loading && (
                              <tr>
                                <td colSpan={10} className="text-center text-muted py-4">{tt('common.nodata', 'No data')}</td>
                              </tr>
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Columna lateral: Perfil activo */}
              <div className="col-12 col-lg-4">
                <div className="card shadow-sm">
                  <div className="card-header"><strong>{tt('admin.taxes.profile.title', 'Active Tax Profile')}</strong></div>
                  <div className="card-body">
                    {!activeProfile ? (
                      <div className="text-muted small">{tt('admin.taxes.profile.none', 'No active profile found.')}</div>
                    ) : (
                      <>
                        <div className="mb-2">
                          <div><strong>{tt('admin.taxes.profile.country', 'Country')}:</strong> {activeProfile.country}</div>
                          <div><strong>{tt('admin.taxes.profile.currency', 'Currency')}:</strong> {activeProfile.currency}</div>
                          <div><strong>{tt('admin.taxes.profile.pricesIncl', 'Prices include tax')}:</strong> {String(!!activeProfile.pricesIncludeTax)}</div>
                          <div><strong>{tt('admin.taxes.profile.rounding', 'Rounding')}:</strong> {activeProfile.rounding}</div>
                        </div>
                        <div className="mb-2">
                          <div><strong>{tt('admin.taxes.profile.rates', 'Rates')}:</strong> {(activeProfile.rates || []).length}</div>
                          <ul className="small text-muted mb-2">
                            {(activeProfile.rates || []).slice(0,5).map((r, i) => (
                              <li key={i}>
                                {r.code} — {(Number(r.rateBps || 0)/100).toFixed(2)}%
                                {r.label ? ` (${r.label})` : ''}
                              </li>
                            ))}
                            {(activeProfile.rates || []).length > 5 && <li>…</li>}
                          </ul>
                        </div>
                        <div className="mb-2">
                          <div><strong>{tt('admin.taxes.profile.serviceCharge', 'Service charge')}:</strong> {(activeProfile.surcharges || [])[0]?.percentBps ? ((activeProfile.surcharges![0].percentBps!/100).toFixed(2)+'%') : tt('admin.taxes.profile.disabled', 'disabled')}</div>
                          <div><strong>{tt('admin.taxes.profile.serviceTaxable', 'Service taxable')}:</strong> {String(!!(activeProfile.surcharges || [])[0]?.taxable)}</div>
                        </div>
                        <div className="mb-2">
                          <div><strong>{tt('admin.taxes.profile.deliveryMode', 'Delivery mode')}:</strong> {activeProfile.delivery?.mode || 'out_of_scope'}</div>
                          <div><strong>{tt('admin.taxes.profile.deliveryTaxable', 'Delivery taxable')}:</strong> {String(!!activeProfile.delivery?.taxable)}</div>
                          {activeProfile.delivery?.taxCode && <div><strong>{tt('admin.taxes.profile.deliveryTaxCode', 'Delivery tax code')}:</strong> {activeProfile.delivery.taxCode}</div>}
                        </div>
                        {Array.isArray(activeProfile.jurisdictions) && activeProfile.jurisdictions.length > 0 && (
                          <div className="mb-2">
                            <div><strong>{tt('admin.taxes.profile.jurisdictions', 'Jurisdictions')}:</strong> {activeProfile.jurisdictions.length}</div>
                            <div className="small text-muted">{tt('admin.taxes.profile.jurisdictionsNote', 'Overrides present (rates/surcharges/delivery/inclusive/rounding).')}</div>
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </div>

                <div className="small text-muted mt-2">
                  {tt('admin.taxes.note.snapshot', 'Snapshot/report uses the same fields as your checkout and tax editor. Adjust filters and press Run.')}
                </div>
              </div>
            </div>
          </main>
        </ToolGate>
      </AdminOnly>
    </Protected>
  );
}
