// src/app/(tenant)/[tenant]/app/admin/delivery-options/page.tsx
'use client';

import React, { useEffect, useMemo, useState } from 'react'; 
import {
  addDoc,
  updateDoc,
  deleteDoc,
  serverTimestamp,
  onSnapshot,
  query,
  orderBy,
} from 'firebase/firestore';

import Protected from "@/app/(tenant)/[tenantId]/components/Protected";
import AdminOnly from "@/app/(tenant)/[tenantId]/components/AdminOnly";

/* 🔐 Gate por plan (Full) */
import ToolGate from "@/components/ToolGate";

/* 🔁 Helpers multi-tenant (Web SDK) */
import { tCol, tDoc } from '@/lib/db';
import { useTenantId } from '@/lib/tenant/context';

import { useFmtQ } from '@/lib/settings/money'; // ✅ formateador global

// 🔤 i18n (mismo patrón que Kitchen)
import { t as translate } from '@/lib/i18n/t';
import { useTenantSettings } from '@/lib/settings/hooks';

type DeliveryOption = {
  id: string;
  title: string;
  description?: string;
  price: number;       // en unidades (no centavos)
  isActive: boolean;
  sortOrder?: number;
  createdAt?: any;
  updatedAt?: any;
};

function AdminDeliveryOptionsPageInner() {
  const tenantId = useTenantId();

  const [list, setList] = useState<DeliveryOption[]>([]);
  const [loading, setLoading] = useState(true);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState<number>(0);
  const [isActive, setIsActive] = useState<boolean>(true);
  const [sortOrder, setSortOrder] = useState<number>(0);

  // ✅ formateador centralizado (por si lo necesitas mostrar en algún label)
  const fmtQ = useFmtQ();

  // ===== i18n bootstrap (idéntico a Kitchen) =====
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

  // 🔁 Live query scoped a tenants/{tenantId}/deliveryOptions
  useEffect(() => {
    if (!tenantId) return;
    const qRef = query(tCol('deliveryOptions', tenantId), orderBy('sortOrder', 'asc'));
    const unsub = onSnapshot(qRef, (snap) => {
      const arr: DeliveryOption[] = snap.docs.map((d) => {
        const raw = d.data() as any;
        return {
          id: d.id,
          title: String(raw.title ?? ''),
          description: raw.description ? String(raw.description) : undefined,
          price: Number(raw.price ?? 0),
          isActive: Boolean(raw.isActive ?? true),
          sortOrder: Number.isFinite(raw.sortOrder) ? Number(raw.sortOrder) : undefined,
          createdAt: raw.createdAt,
          updatedAt: raw.updatedAt,
        };
      });
      setList(arr);
      setLoading(false);
    });
    return () => unsub();
  }, [tenantId]);

  async function onCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!tenantId) return;
    try {
      await addDoc(tCol('deliveryOptions', tenantId), {
        title: title.trim(),
        description: description.trim() || '',
        price: Number(price || 0),
        isActive: Boolean(isActive),
        sortOrder: Number(sortOrder || 0),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        tenantId, // ✅ siempre escribir tenantId
      });
      setTitle('');
      setDescription('');
      setPrice(0);
      setIsActive(true);
      setSortOrder(0);
      alert(tt('admin.deliveryOptions.alert.created', 'Option created'));
    } catch (e) {
      console.error(e);
      alert(tt('admin.deliveryOptions.alert.createError', 'The option could not be created'));
    }
  }

  async function onUpdate(it: DeliveryOption) {
    if (!tenantId) return;
    try {
      await updateDoc(tDoc('deliveryOptions', tenantId, it.id), {
        title: it.title.trim(),
        description: it.description?.trim() || '',
        price: Number(it.price || 0),
        isActive: Boolean(it.isActive),
        sortOrder: Number(it.sortOrder || 0),
        updatedAt: serverTimestamp(),
        tenantId, // ✅ mantener coherencia
      });
      alert(tt('admin.deliveryOptions.alert.updated', 'Updated option'));
    } catch (e) {
      console.error(e);
      alert(tt('admin.deliveryOptions.alert.updateError', 'Could not update'));
    }
  }

  async function onDelete(id: string) {
    if (!tenantId) return;
    if (!confirm(tt('admin.deliveryOptions.confirm.delete', 'Remove this shipping option?'))) return;
    try {
      await deleteDoc(tDoc('deliveryOptions', tenantId, id));
      alert(tt('admin.deliveryOptions.alert.deleted', 'Deleted'));
    } catch (e) {
      console.error(e);
      alert(tt('admin.deliveryOptions.alert.deleteError', 'Could not delete'));
    }
  }

  return (
    <div className="container py-4">
      <h1 className="h4 mb-3">{tt('admin.deliveryOptions.title', 'Delivery options')}</h1>

      {/* Crear nueva */}
      <div className="card border-0 shadow-sm mb-4">
        <div className="card-header">
          <div className="fw-semibold">{tt('admin.deliveryOptions.create.title', 'Create delivery option')}</div>
        </div>
        <form className="card-body" onSubmit={onCreate}>
          <div className="row g-3">
            <div className="col-md-4">
              <label className="form-label">{tt('admin.deliveryOptions.field.title', 'Title')}</label>
              <input className="form-control" value={title} onChange={(e) => setTitle(e.target.value)} required />
            </div>
            <div className="col-md-4">
              <label className="form-label">{tt('admin.deliveryOptions.field.description', 'Description')}</label>
              <input className="form-control" value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="col-md-2">
              <label className="form-label">{tt('admin.deliveryOptions.field.price', 'Price')}</label>
              <input
                type="number"
                step="0.01"
                min="0"
                className="form-control"
                value={price}
                onChange={(e) => setPrice(Number(e.target.value))}
                required
              />
              {/* Preview formateado opcional:
                  <div className="form-text">{fmtQ(price)}</div>
               */}
            </div>
            <div className="col-md-1">
              <label className="form-label">{tt('admin.deliveryOptions.field.active', 'Active')}</label>
              <div className="form-check mt-2">
                <input
                  type="checkbox"
                  className="form-check-input"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                />
              </div>
            </div>
            <div className="col-md-1">
              <label className="form-label">{tt('admin.deliveryOptions.field.order', 'Order')}</label>
              <input
                type="number"
                className="form-control"
                value={sortOrder}
                onChange={(e) => setSortOrder(Number(e.target.value))}
              />
            </div>
          </div>
          <div className="mt-3">
            <button className="btn btn-primary" type="submit">
              {tt('admin.deliveryOptions.btn.save', 'Save')}
            </button>
          </div>
        </form>
      </div>

      {/* Listado y edición */}
      <div className="card border-0 shadow-sm">
        <div className="card-header">
          <div className="fw-semibold">{tt('admin.deliveryOptions.list.title', 'List')}</div>
        </div>
        <div className="card-body">
          {loading ? (
            <div>{tt('admin.deliveryOptions.loading', 'Loading...')}</div>
          ) : list.length === 0 ? (
            <div className="text-muted">{tt('admin.deliveryOptions.empty', 'No records.')}</div>
          ) : (
            <div className="table-responsive">
              <table className="table align-middle">
                <thead>
                  <tr>
                    <th style={{ width: 220 }}>{tt('admin.deliveryOptions.field.title', 'Title')}</th>
                    <th>{tt('admin.deliveryOptions.field.description', 'Description')}</th>
                    <th style={{ width: 120 }}>{tt('admin.deliveryOptions.field.price', 'Price')}</th>
                    <th style={{ width: 80 }}>{tt('admin.deliveryOptions.field.active', 'Active')}</th>
                    <th style={{ width: 100 }}>{tt('admin.deliveryOptions.field.order', 'Order')}</th>
                    <th style={{ width: 180 }} className="text-end">
                      {tt('admin.deliveryOptions.table.actions', 'Actions')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((it, idx) => (
                    <tr key={it.id}>
                      <td>
                        <input
                          className="form-control"
                          value={it.title}
                          onChange={(e) => {
                            const v = e.target.value;
                            setList((arr) => arr.map((x, i) => (i === idx ? { ...x, title: v } : x)));
                          }}
                        />
                      </td>
                      <td>
                        <input
                          className="form-control"
                          value={it.description || ''}
                          onChange={(e) => {
                            const v = e.target.value;
                            setList((arr) => arr.map((x, i) => (i === idx ? { ...x, description: v } : x)));
                          }}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          step="0.01"
                          min="0"
                          className="form-control"
                          value={it.price}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            setList((arr) => arr.map((x, i) => (i === idx ? { ...x, price: Number.isFinite(v) ? v : 0 } : x)));
                          }}
                        />
                        {/* Preview formateado opcional:
                            <div className="form-text">{fmtQ(it.price)}</div>
                         */}
                      </td>
                      <td>
                        <input
                          type="checkbox"
                          className="form-check-input"
                          checked={!!it.isActive}
                          onChange={(e) => {
                            const v = e.target.checked;
                            setList((arr) => arr.map((x, i) => (i === idx ? { ...x, isActive: v } : x)));
                          }}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          className="form-control"
                          value={it.sortOrder ?? 0}
                          onChange={(e) => {
                            const v = Number(e.target.value);
                            setList((arr) => arr.map((x, i) => (i === idx ? { ...x, sortOrder: Number.isFinite(v) ? v : 0 } : x)));
                          }}
                        />
                      </td>
                      <td className="text-end">
                        <button className="btn btn-sm btn-outline-primary me-2" onClick={() => onUpdate(it)}>
                          {tt('admin.deliveryOptions.btn.save', 'Save')}
                        </button>
                        <button className="btn btn-sm btn-outline-danger" onClick={() => onDelete(it.id)}>
                          {tt('admin.deliveryOptions.btn.delete', 'Delete')}
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------
   Export default protegido + Admin + Gate de plan
--------------------------------------------- */
export default function AdminDeliveryOptionsPage() {
  return (
    <Protected>
      <AdminOnly>
        <ToolGate feature="deliveryOptions">
          <AdminDeliveryOptionsPageInner />
        </ToolGate>
      </AdminOnly>
    </Protected>
  );
}
