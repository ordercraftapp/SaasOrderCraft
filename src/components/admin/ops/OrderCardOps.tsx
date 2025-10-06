'use client';

import { useMemo, useState } from 'react';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import type { OrderStatus } from '@/lib/orders/status';
import { ORDER_STATUSES, statusLabel } from '@/lib/orders/status';

// ✅ Formateador global (SettingsProvider)
import { useFmtQ } from '@/lib/settings/money';

type Addon = { name: string; price: number };
type OptionItem = { id: string; name: string; priceDelta: number };
type OptionGroup = { groupId: string; groupName: string; type?: 'single' | 'multi'; items: OptionItem[] };
type OrderItem = {
  menuItemId: string;
  menuItemName: string;
  basePrice: number;         // unidades
  quantity: number;
  addons: Addon[];           // unidades
  optionGroups: OptionGroup[]; // unidades (priceDelta)
  lineTotal?: number;        // unidades
};

type OrderInfoDineIn = { type: 'dine-in'; table?: string; notes?: string };
type OrderInfoDelivery = { type: 'delivery'; address?: string; phone?: string; notes?: string };
type OrderInfo = OrderInfoDineIn | OrderInfoDelivery;

export type OpsOrder = {
  id: string;
  number?: string | number;
  status?: OrderStatus | string;
  items: OrderItem[];
  orderTotal?: number; // unidades (legado)
  orderInfo?: OrderInfo;
  createdAt?: any; // Firestore Timestamp | string
  updatedAt?: any;

  // Opcional: si el padre ya los tiene en centavos
  totalsCents?: {
    subTotalCents?: number;
    taxCents?: number;
    serviceCents?: number;
    grandTotalWithTaxCents?: number;
    currency?: string; // no se usa aquí; el SettingsProvider decide
  };
};

function fmtDate(ts?: any) {
  if (!ts) return '—';
  try {
    const d = typeof ts?.toDate === 'function' ? ts.toDate() : new Date(ts);
    return d.toLocaleString('es-GT', { dateStyle: 'short', timeStyle: 'short' });
  } catch {
    return String(ts);
  }
}

export default function OrderCardOps({
  db,
  order,
}: {
  db: import('firebase/firestore').Firestore;
  order: OpsOrder;
}) {
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<OrderStatus | string>(order.status || 'placed');

  // ✅ usa el formateador global
  const fmtQ = useFmtQ();

  const orderNumber = useMemo(() => {
    if (order.number !== undefined && order.number !== null && String(order.number).trim() !== '') {
      return String(order.number);
    }
    return order.id.slice(0, 6).toUpperCase();
  }, [order.id, order.number]);

  const info = order.orderInfo || ({} as OrderInfo);

  // 🆕 Eliminar ítem con nota (actualiza items + modifiedNote)
  async function handleRemoveItem(index: number) {
    try {
      const note = window.prompt('Escribe una nota sobre esta modificación (requerida):', '');
      if (note == null) return; // usuario canceló
      const finalNote = String(note).trim();
      if (!finalNote) {
        alert('La nota es requerida.');
        return;
      }

      const currentItems = Array.isArray(order.items) ? order.items : [];
      if (index < 0 || index >= currentItems.length) return;

      const newItems = currentItems.filter((_, i) => i !== index);

      setSaving(true);
      await updateDoc(doc(db, 'orders', order.id), {
        items: newItems,
        modifiedNote: finalNote,
        updatedAt: serverTimestamp(),
      });
      // no cambiamos nada más; el onSnapshot del padre refresca la UI
    } catch (e: any) {
      console.error(e);
      alert(e?.message || 'No se pudo eliminar el ítem.');
    } finally {
      setSaving(false);
    }
  }

  // Render de items con precios (en UNIDADES → fmtQ)
  const itemsWithPricing = (
    <div className="d-flex flex-column gap-2">
      {order.items.map((ln, idx) => {
        const unitExtras =
          (ln.addons || []).reduce((a, x) => a + Number(x.price || 0), 0) +
          (ln.optionGroups || []).reduce(
            (ga, g) => ga + (g.items || []).reduce((ia, it) => ia + Number(it.priceDelta || 0), 0),
            0
          );
        const unitTotal = Number(ln.basePrice || 0) + unitExtras; // unidades
        const lineTotal = typeof ln.lineTotal === 'number' ? ln.lineTotal : unitTotal * (ln.quantity || 1); // unidades

        return (
          <div className="border rounded p-2" key={`${ln.menuItemId}-${idx}`}>
            <div className="d-flex justify-content-between align-items-start gap-2">
              <div className="fw-semibold">
                {ln.menuItemName} <span className="text-muted">× {ln.quantity}</span>
              </div>
              <div className="d-flex align-items-center gap-2">
                {/* 🆕 Botón eliminar (–) */}
                <button
                  type="button"
                  className="btn btn-sm btn-outline-danger"
                  aria-label="Eliminar ítem"
                  title="Eliminar ítem"
                  onClick={() => handleRemoveItem(idx)}
                  disabled={saving}
                  style={{ lineHeight: 1, padding: '0.15rem 0.45rem' }}
                >
                  &ndash;
                </button>
                <div className="fw-semibold">{fmtQ(lineTotal)}</div>
              </div>
            </div>

            {(ln.addons?.length || ln.optionGroups?.some(g => g.items?.length)) && (
              <div className="mt-1">
                {(ln.addons || []).map((ad, i) => (
                  <div className="d-flex justify-content-between small" key={`ad-${idx}-${i}`}>
                    <div>— (addons) {ad.name}</div>
                    <div>{fmtQ(ad.price)}</div>
                  </div>
                ))}
                {(ln.optionGroups || []).map((g) =>
                  (g.items || []).map((it) => (
                    <div className="d-flex justify-content-between small" key={`gi-${idx}-${g.groupId}-${it.id}`}>
                      <div>— (groupitems) {it.name}</div>
                      <div>{fmtQ(it.priceDelta)}</div>
                    </div>
                  ))
                )}
              </div>
            )}

            <div className="text-muted small mt-1">({fmtQ(unitTotal)} c/u)</div>
          </div>
        );
      })}

      {/* Total: si hay centavos, convertimos a unidades y usamos fmtQ; si no, legado en unidades */}
      <div className="d-flex justify-content-between border-top pt-2">
        <div className="fw-semibold">Total</div>
        <div className="fw-semibold">
          {Number.isFinite(order?.totalsCents?.grandTotalWithTaxCents as number)
            ? fmtQ((order!.totalsCents!.grandTotalWithTaxCents as number) / 100)
            : fmtQ(order.orderTotal)}
        </div>
      </div>
    </div>
  );

  async function onSaveStatus() {
    try {
      setSaving(true);
      await updateDoc(doc(db, 'orders', order.id), {
        status,
        updatedAt: serverTimestamp(),
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card border-0 shadow-sm">
      <div className="card-header d-flex flex-wrap align-items-center justify-content-between">
        <div className="d-flex flex-column">
          <div className="fw-semibold">Order #{orderNumber}</div>
          <div className="text-muted small">Created: {fmtDate(order.createdAt)}</div>
        </div>

        <div className="text-end small">
          <div className="mb-1">
            <span className="badge text-bg-secondary">{statusLabel(order.status)}</span>
          </div>
          {info?.type === 'dine-in' ? (
            <div>
              <div className="fw-semibold">Dine-in</div>
              {info.table ? <div>Table: {info.table}</div> : null}
              {info.notes ? <div className="text-muted">Note: {info.notes}</div> : null}
            </div>
          ) : info?.type === 'delivery' ? (
            <div>
              <div className="fw-semibold">Delivery</div>
              {info.address ? <div>Address: {info.address}</div> : null}
              {info.phone ? <div>Phone: {info.phone}</div> : null}
              {info.notes ? <div className="text-muted">Note: {info.notes}</div> : null}
            </div>
          ) : null}
        </div>
      </div>

      <div className="card-body">
        {itemsWithPricing}

        <div className="mt-3">
          <label className="form-label fw-semibold">Change status</label>
          <div className="d-flex gap-2">
            <select
              className="form-select"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              disabled={saving}
            >
              {ORDER_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {statusLabel(s)}
                </option>
              ))}
            </select>
            <button className="btn btn-primary" onClick={onSaveStatus} disabled={saving}>
              {saving ? 'Guardando…' : 'Guardar'}
            </button>
          </div>
        </div>
      </div>

      {order.updatedAt ? (
        <div className="card-footer text-muted small">
          Last update: {fmtDate(order.updatedAt)}
        </div>
      ) : null}
    </div>
  );
}
