// src/app/(tenant)/[tenantId]/app/admin/ops/page.tsx
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { getFirestore, onSnapshot, orderBy, query } from 'firebase/firestore';
import Protected from '@/app/(tenant)/[tenantId]/components/Protected';
import AdminOnly from '@/app/(tenant)/[tenantId]/components/AdminOnly';
import ToolGate from '@/components/ToolGate';
import OrderCardOps, { type OpsOrder } from '@/app/(tenant)/[tenantId]/components/admin/ops/OrderCardOps';
import { isActive, isCancelled, isClosed, statusLabel } from '@/lib/orders/status';
import { getActiveTaxProfile, type TaxProfile } from '@/lib/tax/profile';

// ✅ Firebase client bootstrap centralizado
import '@/lib/firebase/client';

// ✅ Tenant helpers
import { useTenantId } from '@/lib/tenant/context';
import { tCol } from '@/lib/db';

// 🔤 i18n
import { t as translate } from '@/lib/i18n/t';
import { useTenantSettings } from '@/lib/settings/hooks';

type FilterKey = 'all' | 'active' | 'closed' | 'cancelled';

function okPayStatus(s: any) {
  return ['paid', 'captured', 'completed', 'succeeded', 'approved'].includes(String(s || '').toLowerCase());
}

/**
 * Carga y mapea pedidos para Ops (TENANT-SCOPED).
 * Fallback de currency: taxSnapshot.currency -> totalsCents.currency -> order.currency -> payment.currency -> defaultCurrency -> 'USD'
 */
function useOrdersForOps(
  db: ReturnType<typeof getFirestore>,
  tenantId: string,
  defaultCurrency?: string
) {
  const [rows, setRows] = useState<OpsOrder[]>([]);

  useEffect(() => {
    if (!tenantId) return;

    const q = query(tCol('orders', tenantId) as any, orderBy('createdAt', 'desc'));
    const unsub = onSnapshot(q, (snap) => {
      const list: OpsOrder[] = snap.docs.map((d: any) => {
        const data = d.data() as any;

        const paidByPaypal =
          (data?.payment?.provider === 'paypal' && okPayStatus(data?.payment?.status)) ||
          (Array.isArray(data?.payments) &&
            data.payments.some((p: any) => p?.provider === 'paypal' && okPayStatus(p?.status))) ||
          (String(data?.paymentProvider || '').toLowerCase() === 'paypal' &&
            okPayStatus(data?.paymentStatus));

        const currency: string =
          data?.taxSnapshot?.currency ||
          data?.totalsCents?.currency ||
          data?.currency ||
          data?.payment?.currency ||
          defaultCurrency ||
          'USD';

        const totalsCents =
          data?.totalsCents && typeof data.totalsCents === 'object'
            ? {
                subTotalCents:
                  Number(
                    data?.totalsCents?.subTotalCents ??
                      data?.taxSnapshot?.totals?.subTotalCents ??
                      0
                  ) || undefined,
                taxCents:
                  Number(
                    data?.totalsCents?.taxCents ??
                      data?.taxSnapshot?.totals?.taxCents ??
                      0
                  ) || undefined,
                serviceCents:
                  Number(
                    data?.totalsCents?.serviceCents ??
                      data?.taxSnapshot?.totals?.serviceCents ??
                      0
                  ) || undefined,
                grandTotalWithTaxCents:
                  Number(
                    data?.totalsCents?.grandTotalWithTaxCents ??
                      data?.taxSnapshot?.totals?.grandTotalWithTaxCents ??
                      0
                  ) || undefined,
                currency,
              }
            : undefined;

        return {
          id: d.id,
          number: data?.number,
          status: data?.status,
          items: Array.isArray(data?.items) ? data.items : [],
          orderTotal: Number(data?.orderTotal ?? data?.totals?.grandTotalWithTax ?? 0),
          orderInfo: data?.orderInfo,
          createdAt: data?.createdAt,
          updatedAt: data?.updatedAt,
          currency,
          totalsCents,
          paidByPaypal,
        } as OpsOrder;
      });

      setRows(list);
    });

    return () => unsub();
  }, [db, tenantId, defaultCurrency]);

  return rows;
}

export default function AdminOpsPage() {
  const db = getFirestore();
  const tenantId = useTenantId() || '';

  const { settings } = useTenantSettings();
  const lang = React.useMemo(() => {
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

  const [activeProfile, setActiveProfile] = useState<TaxProfile | null>(null);
  useEffect(() => {
    (async () => {
      try {
        const p = await getActiveTaxProfile();
        setActiveProfile(p || null);
      } catch {
        setActiveProfile(null);
      }
    })();
  }, []);

  const defaultCurrency = activeProfile?.currency || 'USD';
  const orders = useOrdersForOps(db, tenantId, defaultCurrency);

  const [filter, setFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState('');

  const filtered = useMemo(() => {
    let list = orders;
    if (filter === 'active') list = orders.filter((o) => isActive(o.status || ''));
    if (filter === 'closed') list = orders.filter((o) => isClosed(o.status || ''));
    if (filter === 'cancelled') list = orders.filter((o) => isCancelled(o.status || ''));

    if (filter !== 'closed') list = list.filter((o) => !isClosed(o.status || ''));

    if (search.trim()) {
      const s = search.trim().toLowerCase();
      list = list.filter((o) => {
        const num =
          o.number !== undefined && o.number !== null
            ? String(o.number)
            : o.id.slice(0, 6);

        const hayInfo = JSON.stringify(o.orderInfo || {}).toLowerCase();
        const hayItems = (o.items || []).some((ln) =>
          String(ln.menuItemName || '').toLowerCase().includes(s)
        );

        return (
          num.toLowerCase().includes(s) ||
          (o.status && statusLabel(o.status).toLowerCase().includes(s)) ||
          hayInfo.includes(s) ||
          hayItems
        );
      });
    }

    return list;
  }, [orders, filter, search]);

  return (
    <Protected>
      <AdminOnly>
        <ToolGate feature="ops">
          <div className="container py-4">
            <div className="d-flex flex-wrap align-items-center justify-content-between mb-3 gap-2">
              <h1 className="h4 m-0">{tt('ops.title', 'Ops — Orders')}</h1>
              <div className="d-flex gap-2">
                <div className="btn-group" role="group" aria-label={tt('ops.filters.aria', 'Filters')}>
                  <button
                    className={`btn btn-sm ${filter === 'all' ? 'btn-primary' : 'btn-outline-primary'}`}
                    onClick={() => setFilter('all')}
                  >
                    {tt('ops.filters.all', 'All')}
                  </button>
                  <button
                    className={`btn btn-sm ${filter === 'active' ? 'btn-primary' : 'btn-outline-primary'}`}
                    onClick={() => setFilter('active')}
                  >
                    {tt('ops.filters.active', 'Active')}
                  </button>
                  <button
                    className={`btn btn-sm ${filter === 'closed' ? 'btn-primary' : 'btn-outline-primary'}`}
                    onClick={() => setFilter('closed')}
                  >
                    {tt('ops.filters.closed', 'Closed')}
                  </button>
                  <button
                    className={`btn btn-sm ${filter === 'cancelled' ? 'btn-primary' : 'btn-outline-primary'}`}
                    onClick={() => setFilter('cancelled')}
                  >
                    {tt('ops.filters.cancelled', 'Cancelled')}
                  </button>
                </div>

                <input
                  className="form-control form-control-sm"
                  placeholder={tt('ops.searchPlaceholder', 'Search (number, status, table, address, dish...)')}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  style={{ minWidth: 260 }}
                />
              </div>
            </div>

            {filtered.length === 0 ? (
              <div className="alert alert-light border">{tt('ops.empty', 'No orders to show.')}</div>
            ) : (
              <div className="row g-3">
                {filtered.map((ord) => (
                  <div className="col-12 col-md-6 col-xl-4" key={ord.id}>
                    <div className="position-relative">
                      {(ord as any).paidByPaypal && (
                        <span
                          className="badge bg-info text-dark position-absolute rounded-pill shadow-sm"
                          style={{
                            left: 16,
                            top: 54,
                            zIndex: 2,
                            border: '1px solid rgba(255,255,255,.8)',
                            pointerEvents: 'none',
                          }}
                        >
                          {tt('ops.badge.paypal', 'PayPal')}
                        </span>
                      )}

                      {/* Nota: OrderCardOps debe ser tenant-aware internamente.
                         Si lo necesitas, podemos pasar tenantId como prop extra. */}
                      <OrderCardOps db={db} order={ord} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </ToolGate>
      </AdminOnly>
    </Protected>
  );
}
