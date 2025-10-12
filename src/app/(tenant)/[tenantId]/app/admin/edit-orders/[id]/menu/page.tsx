// src/app/(tenant)/[tenant]/app/admin/edit-orders/[id]/menu/page.tsx
'use client';

import { useParams, useRouter } from 'next/navigation';
import React, { useEffect, useState } from 'react';
import Protected from '@/app/(tenant)/[tenantId]/components/Protected';
import { RoleGate } from '@/app/(tenant)/[tenantId]/components/RoleGate'; // allow={['admin','waiter']}
/* 🔐 Gate por plan */
import ToolGate from '@/components/ToolGate';

// 🔤 i18n
import { t as translate } from "@/lib/i18n/t";
import { useTenantSettings } from "@/lib/settings/hooks";

const storageKey = (orderId: string) => `editcart:${orderId}`;

type MenuItem = {
  id: string;
  name: string;
  price?: number;

  // Formatos conocidos
  addons?: Array<{ name: string; price?: number }>;
  optionGroups?: Array<{
    groupId?: string;
    groupName?: string;
    type?: 'single' | 'multiple';
    items: Array<{ id?: string; name?: string; priceDelta?: number; price?: number }>;
  }>;

  // Posibles alias que he visto en menús
  options?: Array<{ groupId?: string; groupName?: string; items: Array<{ id?: string; name?: string; priceDelta?: number; price?: number }> }>;
  groups?: Array<{ id?: string; name?: string; items: Array<{ id?: string; name?: string; priceDelta?: number; price?: number }> }>;
  option_groups?: Array<{ id?: string; name?: string; items: Array<{ id?: string; name?: string; priceDelta?: number; price?: number }> }>;
};

type NewLine = {
  menuItemId?: string;
  menuItemName?: string;
  basePrice?: number;
  quantity?: number;
  addons: Array<{ name: string; price?: number }>;
  optionGroups: Array<{
    groupId: string;
    groupName: string;
    type?: 'single' | 'multiple';
    items: Array<{ id: string; name: string; priceDelta?: number }>;
  }>;
  lineTotal?: number;
};

const toNum = (x: any) => (Number.isFinite(Number(x)) ? Number(x) : 0);

/** Detección robusta de option-groups sin importar cómo vengan nombradas las llaves */
function toOptionGroups(mi: MenuItem): NonNullable<NewLine['optionGroups']> {
  // 1) Directo si ya está en el formato esperado
  if (Array.isArray(mi.optionGroups) && mi.optionGroups.length) {
    return mi.optionGroups.map((g) => ({
      groupId: String(g.groupId ?? g.groupName ?? 'group'),
      groupName: String(g.groupName ?? g.groupId ?? 'Opciones'),
      type: (g.type === 'multiple' ? 'multiple' : 'single') as 'single' | 'multiple',
      items: (g.items || []).map((it) => ({
        id: String(it.id ?? it.name ?? Math.random()),
        name: String(it.name ?? 'Opción'),
        // algunos menús ponen price en lugar de priceDelta
        priceDelta: Number.isFinite(Number((it as any).priceDelta))
          ? Number((it as any).priceDelta)
          : Number.isFinite(Number((it as any).price))
          ? Number((it as any).price)
          : undefined,
      })),
    }));
  }

  // 2) Alias comunes: options, groups, option_groups
  const candidates: any[] = [];
  if (Array.isArray(mi.options)) candidates.push(...mi.options);
  if (Array.isArray(mi.groups)) candidates.push(...mi.groups);
  if (Array.isArray(mi.option_groups)) candidates.push(...mi.option_groups);

  if (candidates.length) {
    return candidates.map((g: any) => ({
      groupId: String(g.groupId ?? g.id ?? g.groupName ?? g.name ?? 'group'),
      groupName: String(g.groupName ?? g.name ?? 'Opciones'),
      type: 'single' as const,
      items: (g.items || []).map((it: any) => ({
        id: String(it.id ?? it.name ?? Math.random()),
        name: String(it.name ?? 'Opción'),
        priceDelta: Number.isFinite(Number(it.priceDelta))
          ? Number(it.priceDelta)
          : Number.isFinite(Number(it.price))
          ? Number(it.price)
          : undefined,
      })),
    })) as NonNullable<NewLine['optionGroups']>;
  }

  // 3) Exploración genérica: busca arrays con objetos que tengan "items"
  for (const [key, val] of Object.entries(mi as any)) {
    if (!Array.isArray(val)) continue;
    if (!val.length) continue;
    const looksLikeGroupArray = val.every(
      (g: any) => typeof g === 'object' && Array.isArray(g?.items)
    );
    if (looksLikeGroupArray) {
      return (val as any[]).map((g: any, i: number) => ({
        groupId: String(g.groupId ?? g.id ?? g.groupName ?? g.name ?? `group_${i}`),
        groupName: String(g.groupName ?? g.name ?? `Opciones ${i + 1}`),
        type: (g.type === 'multiple' ? 'multiple' : 'single') as 'single' | 'multiple',
        items: (g.items || []).map((it: any, j: number) => ({
          id: String(it.id ?? it.name ?? `opt_${i}_${j}`),
          name: String(it.name ?? `Opción ${j + 1}`),
          priceDelta: Number.isFinite(Number(it.priceDelta))
            ? Number(it.priceDelta)
            : Number.isFinite(Number(it.price))
            ? Number(it.price)
            : undefined,
        })),
      })) as NonNullable<NewLine['optionGroups']>;
    }
  }

  return [];
}

function perUnitAddonsQ(line: NewLine) {
  let s = 0;
  for (const g of line.optionGroups || [])
    for (const it of g.items || []) s += toNum(it.priceDelta);
  for (const a of line.addons || []) s += toNum(a.price);
  return s;
}
function computeLineTotal(l: NewLine) {
  const q = Number(l.quantity || 1);
  const base = toNum(l.basePrice);
  return (base + perUnitAddonsQ(l)) * q;
}

export default function EditOrderMenuPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [menu, setMenu] = useState<MenuItem[]>([]);
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const [qtyBy, setQtyBy] = useState<Record<string, number>>({});
  const [addonsSel, setAddonsSel] = useState<Record<string, Record<string, boolean>>>({});
  const [optSel, setOptSel] = useState<Record<string, Record<string, boolean>>>({});

  // 🔤 i18n init
  const { settings } = useTenantSettings();
  const lang = React.useMemo(() => {
    try {
      if (typeof window !== "undefined") {
        const ls = localStorage.getItem("tenant.language");
        if (ls) return ls;
      }
    } catch {}
    return (settings as any)?.language;
  }, [settings]);
  const tt = (key: string, fallback: string, vars?: Record<string, unknown>) => {
    const s = translate(lang, key, vars);
    return s === key ? fallback : s;
  };

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        let items: MenuItem[] | null = null;
        try {
          const r = await fetch('/api/menu?flat=1', { cache: 'no-store' });
          if (r.ok) {
            const j = await r.json();
            items = (j.items || j) as MenuItem[];
          }
        } catch {}
        if (!items) {
          const r2 = await fetch('/api/menu', { cache: 'no-store' }).catch(() => null);
          if (r2 && r2.ok) {
            const j = await r2.json();
            items = (j.items || j) as MenuItem[];
          }
        }
        if (alive) setMenu(items || []);
      } catch (e) {
        console.error(e);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const toggle = (mid: string) => setOpen((m) => ({ ...m, [mid]: !m[mid] }));
  const setQty = (mid: string, q: number) =>
    setQtyBy((m) => ({ ...m, [mid]: Math.max(1, Math.min(99, Math.floor(q || 1))) }));
  const checkAddon = (mid: string, name: string) => !!addonsSel[mid]?.[name];
  const toggleAddon = (mid: string, name: string) =>
    setAddonsSel((m) => ({ ...m, [mid]: { ...(m[mid] || {}), [name]: !m[mid]?.[name] } }));

  // Selección de opciones: usar clave robusta (id || name)
  const isOptChecked = (mid: string, key: string) => !!optSel[mid]?.[key];
  const toggleOpt = (mid: string, key: string) =>
    setOptSel((m) => ({ ...m, [mid]: { ...(m[mid] || {}), [key]: !m[mid]?.[key] } }));

  function addToCart(mi: MenuItem) {
    const groups = toOptionGroups(mi);

    const selectedAddons = (mi.addons || []).filter((a) => !!addonsSel[mi.id]?.[a.name]);

    const selectedOpts: NewLine['optionGroups'] = groups
      .map((g) => ({
        groupId: String(g.groupId ?? g.groupName ?? 'group'),
        groupName: String(g.groupName ?? g.groupId ?? 'Opciones'),
        type: (g.type === 'multiple' ? 'multiple' : 'single') as 'single' | 'multiple',
        items: (g.items || [])
          .filter((it) => !!optSel[mi.id]?.[String(it.id ?? it.name)])
          .map((it) => ({
            id: String(it.id ?? it.name),
            name: String(it.name ?? 'Opción'),
            priceDelta: Number.isFinite(Number((it as any).priceDelta))
              ? Number((it as any).priceDelta)
              : Number.isFinite(Number((it as any).price))
              ? Number((it as any).price)
              : undefined,
          })),
      }))
      .filter((g) => g.items.length > 0);

    const line: NewLine = {
      menuItemId: mi.id,
      menuItemName: mi.name,
      basePrice: mi.price ?? 0,
      quantity: qtyBy[mi.id] || 1,
      addons: selectedAddons.map((a) => ({ name: a.name, price: a.price })),
      optionGroups: selectedOpts,
    };
    line.lineTotal = computeLineTotal(line);

    const key = storageKey(String(id));
    const prev: NewLine[] = JSON.parse(sessionStorage.getItem(key) || '[]');
    sessionStorage.setItem(key, JSON.stringify([...prev, line]));
    router.push(`/admin/edit-orders/${id}/cart`);
  }

  const formatGTQ = (n: number) =>
    new Intl.NumberFormat('es-GT', { style: 'currency', currency: 'GTQ' }).format(n);

  return (
    <Protected>
      <RoleGate allow={['admin','waiter']}>
        <ToolGate feature="editOrders">
          <div className="container py-4">
            <h1 className="h5 mb-3">
              {tt('admin.editmenu.title', 'Add to order')} #{String(id).slice(0, 6)}
            </h1>

            {menu.length === 0 && (
              <div className="alert alert-light border">
                {tt('admin.editmenu.empty', 'No dishes were found.')}
              </div>
            )}

            <div className="list-group">
              {menu.map((mi) => {
                const isOpen = !!open[mi.id];
                const q = qtyBy[mi.id] || 1;
                const groups = toOptionGroups(mi);
                return (
                  <div key={mi.id} className="list-group-item">
                    <div className="d-flex align-items-center justify-content-between">
                      <div>
                        <div className="fw-semibold">{mi.name}</div>
                        <div className="small text-muted">
                          {mi.price !== undefined ? formatGTQ(toNum(mi.price)) : '—'}
                        </div>
                      </div>
                      <div className="d-flex align-items-center gap-2">
                        <input
                          type="number"
                          className="form-control form-control-sm"
                          style={{ width: 90 }}
                          value={q}
                          min={1}
                          max={99}
                          onChange={(e) => setQty(mi.id, Number(e.target.value))}
                        />
                        <button
                          className="btn btn-outline-secondary btn-sm"
                          onClick={() => toggle(mi.id)}
                        >
                          {isOpen
                            ? tt('admin.editmenu.hide', 'Hide')
                            : tt('admin.editmenu.options', 'Options')}
                        </button>
                        <button className="btn btn-primary btn-sm" onClick={() => addToCart(mi)}>
                          {tt('admin.editmenu.add', 'Add')}
                        </button>
                      </div>
                    </div>

                    {isOpen && (
                      <div className="mt-3">
                        {(mi.addons || []).length > 0 && (
                          <div className="mb-3">
                            <div className="fw-semibold">{tt('common.addons', 'Addons')}</div>
                            {(mi.addons || []).map((a) => (
                              <label key={a.name} className="d-flex align-items-center gap-2">
                                <input
                                  type="checkbox"
                                  checked={checkAddon(mi.id, a.name)}
                                  onChange={() => toggleAddon(mi.id, a.name)}
                                />
                                <span>{a.name}</span>
                                <span className="text-muted small">
                                  {a.price !== undefined ? `(${formatGTQ(toNum(a.price))})` : '—'}
                                </span>
                              </label>
                            ))}
                          </div>
                        )}

                        {/* Option-groups */}
                        {groups.map((g, gi) => (
                          <div key={`${g.groupId}_${gi}`} className="mb-2">
                            <div className="fw-semibold">{g.groupName}</div>
                            {(g.items || []).map((it, ii) => {
                              const key = String(it.id ?? it.name);
                              return (
                                <label key={`${key}_${ii}`} className="d-flex align-items-center gap-2">
                                  <input
                                    type="checkbox"
                                    checked={isOptChecked(mi.id, key)}
                                    onChange={() => toggleOpt(mi.id, key)}
                                  />
                                  <span>{it.name}</span>
                                  <span className="text-muted small">
                                    {it.priceDelta !== undefined
                                      ? `(${formatGTQ(toNum(it.priceDelta))})`
                                      : ''}
                                  </span>
                                </label>
                              );
                            })}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </ToolGate>
      </RoleGate>
    </Protected>
  );
}
