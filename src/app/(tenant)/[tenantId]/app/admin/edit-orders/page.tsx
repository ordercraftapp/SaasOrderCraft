'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';

/* 🔐 NOTA: Agregado para seguridad */
import Protected from '@/app/(tenant)/[tenantId]/components/Protected';
import { RoleGate } from '@/app/(tenant)/[tenantId]/components/RoleGate'; // allow={['admin','waiter']}
import { useFmtQ } from '@/lib/settings/money'; // ✅ usar formateador global
import ToolGate from '@/components/ToolGate'; // ✅ gate por feature edit_orders

// 🔤 i18n
import { t as translate } from "@/lib/i18n/t";
import { useTenantSettings } from "@/lib/settings/hooks";

type TS = any;

type OptItem = {
  id?: string; name?: string;
  price?: number; priceCents?: number;
  priceDelta?: number; priceDeltaCents?: number;
  priceExtra?: number; priceExtraCents?: number;
};
type Line = {
  menuItemName?: string; name?: string; menuItem?: { price?: number; priceCents?: number } | null;
  quantity?: number;
  basePrice?: number; unitPrice?: number; unitPriceCents?: number; price?: number; priceCents?: number;
  totalCents?: number; lineTotal?: number;
  addons?: Array<string | { name?: string; price?: number; priceCents?: number }>;
  optionGroups?: Array<{ groupId?: string; groupName?: string; type?: 'single'|'multiple'; items: OptItem[] }>;
  options?: Array<{ groupName: string; selected: OptItem[] }>;
};
type Order = {
  id: string; orderNumber?: string|number; status?: string; currency?: string;
  createdAt?: TS;
  orderInfo?: { type?: 'dine-in'|'delivery'|'pickup'; table?: string } | null;
  tableNumber?: string | null;
  items?: Line[]; lines?: any[];
  amounts?: { total?: number } | null; totals?: { totalCents?: number } | null; orderTotal?: number | null;
  userEmail?: string|null; createdBy?: { email?: string|null } | null;
};

const toNum=(x:any)=> (Number.isFinite(Number(x))?Number(x):undefined);
const centsToQ=(c?:number)=> (Number.isFinite(c)?Number(c)/100:0);
function tsToDate(ts:TS){ if(!ts) return null; try{
  if (typeof (ts as any).toDate === 'function') return (ts as any).toDate();
  if (typeof (ts as any).seconds === 'number') return new Date((ts as any).seconds*1000);
  if (typeof ts === 'number') return new Date(ts);
  const d = new Date(ts); return isNaN(d.getTime())? null : d;
}catch{return null;} }
// (mantengo esta función aunque ya no se usa, para no tocar nada más de la estructura)
// function fmtMoney(n?:number, cur='USD'){ const v=Number(n||0); try{ return new Intl.NumberFormat('es-GT',{style:'currency',currency:cur}).format(v);}catch{return `Q ${v.toFixed(2)}`;} }
function extractDeltaQ(x:any){ const a=toNum(x?.priceDelta); if(a!==undefined) return a;
  const b=toNum(x?.priceExtra); if(b!==undefined) return b;
  const ac=toNum(x?.priceDeltaCents); if(ac!==undefined) return ac/100;
  const bc=toNum(x?.priceExtraCents); if(bc!==undefined) return bc/100;
  const p=toNum(x?.price); if(p!==undefined) return p;
  const pc=toNum(x?.priceCents); if(pc!==undefined) return pc/100;
  return 0;
}
function perUnitAddonsQ(l:Line){ let s=0;
  if(Array.isArray(l.optionGroups)) for(const g of l.optionGroups) for(const it of (g.items||[])) s += extractDeltaQ(it);
  if(Array.isArray(l.options)) for(const g of l.options) for(const it of (g.selected||[])) s += extractDeltaQ(it);
  for (const it of (l.addons||[])) {
    if (typeof it === 'string') continue;
    const p = toNum(it?.price) ?? (toNum(it?.priceCents)!==undefined ? Number(it!.priceCents)/100 : undefined);
    s += p ?? 0;
  }
  return s;
}
function baseUnitPriceQ(l:Line){ const b=toNum(l.basePrice); if(b!==undefined) return b;
  const upc=toNum(l.unitPriceCents); if(upc!==undefined) return upc/100;
  const up=toNum(l.unitPrice); if(up!==undefined) return up;
  const pc=toNum(l.priceCents); if(pc!==undefined) return pc/100;
  const p=toNum(l.price); if(p!==undefined) return p;
  const miC=toNum(l.menuItem?.priceCents); if(miC!==undefined) return miC/100;
  const mi=toNum(l.menuItem?.price); if(mi!==undefined) return mi;
  const tC=toNum(l.totalCents), q=Number(l.quantity||1); if(tC!==undefined && q>0){ const per=tC/100/q; const add=perUnitAddonsQ(l); return Math.max(0, per - add); }
  return 0;
}
function lineTotalQ(l:Line){ if(toNum(l.lineTotal)!==undefined) return Number(l.lineTotal);
  if(toNum(l.totalCents)!==undefined) return Number(l.totalCents)/100;
  const q=Number(l.quantity||1); return (baseUnitPriceQ(l)+perUnitAddonsQ(l))*q;
}
function orderTotalQ(o:Order){ if(toNum(o.amounts?.total)!==undefined) return Number(o.amounts!.total);
  if(toNum(o.orderTotal)!==undefined) return Number(o.orderTotal);
  if(toNum(o.totals?.totalCents)!==undefined) return centsToQ(o.totals!.totalCents!);
  const lines=(o.items||[]); if(lines.length) return lines.reduce((acc,l)=>acc+lineTotalQ(l),0);
  return 0;
}
function displayType(o:Order){ const t=o.orderInfo?.type?.toLowerCase?.(); if(t==='delivery') return 'Delivery'; if(t==='dine-in') return 'Dine-in'; return o.orderInfo?.type || '-'; }
function getQty(l:Line){ return Number(l?.quantity ?? 1) || 1; }
function getName(l:Line){ return String(l?.menuItemName ?? l?.name ?? 'Ítem'); }

// ⏱️ helper para determinar cuándo se cerró (si está disponible)
function closedAtMs(o:any): number | null {
  // intenta statusHistory[].to === 'closed' con .at
  const hist = Array.isArray(o?.statusHistory) ? o.statusHistory : [];
  for (let i = hist.length - 1; i >= 0; i--) {
    const e = hist[i];
    const to = String(e?.to ?? e?.status ?? '').toLowerCase();
    if (to === 'closed') {
      const d = tsToDate(e?.at);
      if (d) return d.getTime();
    }
  }
  // intenta closedAt / updatedAt
  const d = tsToDate(o?.closedAt) || tsToDate(o?.updatedAt) || tsToDate(o?.createdAt);
  return d ? d.getTime() : null;
}

type ApiList = { ok?: boolean; orders?: Order[]; items?: Order[]; error?: string };

export default function EditOrdersListPage() {
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');

  // ✅ formateador global para toda la página
  const fmtQ = useFmtQ();

  // 🔤 idioma (leer de settings y fallback a localStorage)
  const { settings } = useTenantSettings();
  const lang = useMemo(() => {
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

  useEffect(()=>{ let alive=true;(async()=>{
    try{
      const res = await fetch('/api/orders?limit=100',{cache:'no-store'});
      const data: ApiList = await res.json();
      if(!res.ok || data?.ok===false) throw new Error(data?.error||`HTTP ${res.status}`);
      const list = (data.orders || data.items || []).map((o:any)=>o) as Order[];
      if(alive) setOrders(list);
    } catch(e){ console.error(e); } finally { if(alive) setLoading(false); }
  })(); return ()=>{alive=false}; },[]);

  const filtered = useMemo(()=>{
    // 1) Solo dine-in y pickup
    const dineInOrPickup = orders.filter(o=>{
      const t = o.orderInfo?.type?.toLowerCase?.();
      if (t === 'delivery') return false;
      if (t === 'dine-in' || t === 'pickup') return true;
      // fallback: si no hay tipo pero no tiene deliveryAddress, trátalo como dine-in
      return !('deliveryAddress' in o) || !(o as any).deliveryAddress;
    });

    // 2) Ocultar cerradas después de 2 horas
    const now = Date.now();
    const TWO_HOURS = 2 * 60 * 60 * 1000;
    const ttlFiltered = dineInOrPickup.filter(o=>{
      const st = String(o.status || '').toLowerCase();
      if (st !== 'closed') return true;
      const tms = closedAtMs(o);
      return tms === null ? true : (now - tms) <= TWO_HOURS;
    });

    // 3) Búsqueda existente (email o número)
    const s=q.trim().toLowerCase();
    if(!s) return ttlFiltered;
    return ttlFiltered.filter(o=>{
      const email = (o.userEmail || o.createdBy?.email || '').toLowerCase();
      const num = String(o.orderNumber ?? o.id).toLowerCase();
      return email.includes(s) || num.includes(s);
    });
  },[orders,q]);

  /* 🔐 NOTA: Envolver TODO el contenido visible con ToolGate + Protected + RoleGate */
  return (
    <ToolGate feature="editOrders">
      <Protected>
        <RoleGate allow={['admin','waiter']}>
          <div className="container py-4">
            <div className="d-flex align-items-center justify-content-between mb-3">
              <h1 className="h4 m-0">{tt('admin.editorders.title','Edit orders')}</h1>
              <div className="input-group" style={{maxWidth: 360}}>
                <span className="input-group-text">@</span>
                <input
                  className="form-control"
                  placeholder={tt('admin.editorders.searchPh','Search by email or #')}
                  value={q}
                  onChange={e=>setQ(e.target.value)}
                />
              </div>
            </div>

            {loading && <div className="alert alert-info">{tt('common.loading','Loading...')}</div>}

            {!loading && (
              <ul className="list-group">
                {filtered.map(o=>{
                  const total = orderTotalQ(o);
                  const d = tsToDate(o.createdAt)?.toLocaleString() ?? '-';
                  const n = o.orderNumber ?? o.id.slice(0,6);
                  const typeLabel = (() => {
                    const raw = displayType(o);
                    if (raw === 'Delivery') return tt('admin.kitchen.delivery','Delivery');
                    if (raw === 'Dine-in') return tt('admin.kitchen.dinein','Dine-in');
                    if (String(raw).toLowerCase() === 'pickup') return tt('admin.kitchen.pickup','Pickup');
                    return String(raw || '-');
                  })();
                  return (
                    <li key={o.id} className="list-group-item">
                      <div className="d-flex flex-column flex-md-row align-items-start align-items-md-center justify-content-between">
                        <div>
                          <div className="fw-semibold">#{n} <span className="badge text-bg-light">{typeLabel}</span></div>
                          <div className="small text-muted">{tt('common.date','Date')}: {d}</div>
                        </div>
                        <div className="d-flex align-items-center gap-2 mt-2 mt-md-0">
                          <div className="fw-bold">{fmtQ(total)}</div>
                          <Link href={`/admin/edit-orders/${o.id}/menu`} className="btn btn-primary btn-sm">
                            {tt('common.edit','Edit')}
                          </Link>
                        </div>
                      </div>

                      {/* Detalle completo de líneas */}
                      <div className="mt-2">
                        {(o.items||[]).map((l, idx)=>{
                          const qty = getQty(l);
                          const name = getName(l);
                          const base = baseUnitPriceQ(l);
                          const sum = lineTotalQ(l);
                          return (
                            <div key={idx} className="small mb-2 border-top pt-2">
                              <div className="d-flex justify-content-between">
                                <div>• {qty} × {name}</div>
                                <div className="text-muted">({fmtQ(base)} c/u)</div>
                              </div>

                              {/* optionGroups / options con precio */}
                              {Array.isArray(l.optionGroups) && l.optionGroups.map((g,gi)=>{
                                const rows = (g.items||[]).map((it,ii)=>{
                                  const p = extractDeltaQ(it);
                                  return <span key={ii}>{it?.name}{p?` (${fmtQ(p)})`:''}{ii<(g.items!.length-1)?', ':''}</span>;
                                });
                                return rows.length?(
                                  <div key={gi} className="ms-3 text-muted">
                                    <span className="fw-semibold">{g.groupName || tt('common.options','Options')}:</span> {rows}
                                  </div>
                                ):null;
                              })}

                              {Array.isArray(l.options) && l.options.map((g,gi)=>{
                                const rows = (g.selected||[]).map((it,ii)=>{
                                  const p = extractDeltaQ(it);
                                  return <span key={ii}>{it?.name}{p?` (${fmtQ(p)})`:''}{ii<(g.selected!.length-1)?', ':''}</span>;
                                });
                                return rows.length?(
                                  <div key={`op-${gi}`} className="ms-3 text-muted">
                                    <span className="fw-semibold">{g.groupName || tt('common.options','Options')}:</span> {rows}
                                  </div>
                                ):null;
                              })}

                              {/* addons con precio */}
                              {Array.isArray(l.addons) && l.addons.length>0 && (
                                <div className="ms-3 text-muted">
                                  <span className="fw-semibold">{tt('common.addons','Add-ons')}:</span>{' '}
                                  {l.addons.map((ad:any,ai:number)=>{
                                    if (typeof ad==='string') return <span key={ai}>{ad}{ai<l.addons!.length-1?', ':''}</span>;
                                    const p = toNum(ad?.price) ?? (toNum(ad?.priceCents)!==undefined ? Number(ad!.priceCents)/100 : undefined);
                                    return <span key={ai}>{ad?.name}{p?` (${fmtQ(p)})`:''}{ai<l.addons!.length-1?', ':''}</span>;
                                  })}
                                </div>
                              )}

                              <div className="d-flex justify-content-between">
                                <span className="text-muted">{tt('admin.cashier.lineSubtotal','Subtotal line')}</span>
                                <span className="text-muted">{fmtQ(sum)}</span>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </li>
                  );
                })}
                {filtered.length===0 && <li className="list-group-item text-muted">{tt('common.noResults','No results')}</li>}
              </ul>
            )}
          </div>
        </RoleGate>
      </Protected>
    </ToolGate>
  );
}
