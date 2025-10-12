// src/app/(tenant)/[tenant]/app/admin/edit-orders/[id]/cart/page.tsx
'use client';

import { useParams, useRouter } from 'next/navigation';
import React, { useEffect, useMemo, useState } from 'react';
import Protected from '@/app/(tenant)/[tenantId]/components/Protected';
import { RoleGate } from '@/app/(tenant)/[tenantId]/components/RoleGate'; // allow={['admin','waiter']}

/* 🔐 Gate por plan (Pro/Full) */
import ToolGate from '@/components/ToolGate';

import { useFmtQ } from '@/lib/settings/money'; // ✅ formateador global

// 🔤 i18n
import { t as translate } from "@/lib/i18n/t";
import { useTenantSettings } from "@/lib/settings/hooks";

/* ---------- Auth opcional (solo si existe usuario) ---------- */
function getFirebaseClientConfig() {
  return {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
  };
}
async function ensureFirebaseApp() {
  const app = await import('firebase/app');
  if (!app.getApps().length) {
    const cfg = getFirebaseClientConfig();
    if (cfg.apiKey && cfg.authDomain && cfg.projectId && cfg.appId) {
      app.initializeApp(cfg);
    }
  }
}
async function getAuthMod() {
  await ensureFirebaseApp();
  return await import('firebase/auth');
}
async function getIdTokenSafe(forceRefresh = false): Promise<string | null> {
  try {
    const { getAuth } = await getAuthMod();
    const auth = getAuth();
    const user = auth.currentUser;
    if (!user) return null;
    return await user.getIdToken(forceRefresh);
  } catch {
    return null;
  }
}
async function apiFetch(path: string, init?: RequestInit) {
  let token = await getIdTokenSafe(false);
  let headers: HeadersInit = { ...(init?.headers || {}) };
  if (token) (headers as any)['Authorization'] = `Bearer ${token}`;
  let res = await fetch(path, { ...init, headers, cache: 'no-store' });

  if (res.status === 401) {
    token = await getIdTokenSafe(true);
    headers = { ...(init?.headers || {}) };
    if (token) (headers as any)['Authorization'] = `Bearer ${token}`;
    res = await fetch(path, { ...init, headers, cache: 'no-store' });
  }
  return res;
}

/* ---------- Tipos y helpers ---------- */
const storageKey = (orderId: string) => `editcart:${orderId}`;

type OptItem = { id?:string; name?:string; priceDelta?:number; price?:number; priceCents?:number; };
type Line = {
  menuItemName?: string; name?: string; quantity?: number; basePrice?: number;
  unitPrice?: number; unitPriceCents?: number; price?: number; priceCents?: number; totalCents?: number; lineTotal?: number;
  addons?: Array<string | { name?: string; price?: number; priceCents?: number }>;
  optionGroups?: Array<{ groupId?: string; groupName?: string; type?: 'single'|'multiple'; items: OptItem[] }>;
  options?: Array<{ groupName: string; selected: OptItem[] }>;
  menuItem?: { price?: number; priceCents?: number } | null;
};
type Order = {
  id?:string;
  currency?:string;
  items?:Line[];
  lines?:Line[]; // legacy
  orderTotal?:number;
  totals?:{totalCents?:number}|null;
  amounts?:{total?:number}|null
};

const toNum=(x:any)=> (Number.isFinite(Number(x))?Number(x):undefined);
const centsToQ=(c?:number)=> (Number.isFinite(c)?Number(c)/100:0);
function getQty(l:Line){ return Number(l?.quantity ?? 1) || 1; }
function getName(l:Line){ return String(l?.menuItemName ?? l?.name ?? 'Ítem'); }
function extractDeltaQ(x:any){
  const pds=[
    x?.priceDelta,
    x?.priceExtra,
    x?.priceDeltaCents!==undefined?Number(x.priceDeltaCents)/100:undefined,
    x?.priceExtraCents!==undefined?Number(x.priceExtraCents)/100:undefined,
    x?.price,
    x?.priceCents!==undefined?Number(x.priceCents)/100:undefined
  ];
  for(const v of pds){ const n=Number(v); if(Number.isFinite(n)) return n; }
  return 0;
}
function perUnitAddonsQ(l:Line){
  let s=0;
  if(Array.isArray(l.optionGroups)) for(const g of l.optionGroups) for(const it of (g.items||[])) s+=extractDeltaQ(it);
  if(Array.isArray(l.options)) for(const g of l.options) for(const it of (g.selected||[])) s+=extractDeltaQ(it);
  const ad=(l.addons||[]);
  for(const it of ad){
    if(typeof it==='string') continue;
    const p=toNum(it?.price) ?? (toNum(it?.priceCents)!==undefined ? Number(it!.priceCents)/100 : undefined);
    s += p ?? 0;
  }
  return s;
}
function baseUnitPriceQ(l:Line){
  const b=toNum(l.basePrice); if(b!==undefined) return b;
  const upc=toNum(l.unitPriceCents); if(upc!==undefined) return upc/100;
  const up=toNum(l.unitPrice); if(up!==undefined) return up;
  const pc=toNum(l.priceCents); if(pc!==undefined) return pc/100;
  const p=toNum(l.price); if(p!==undefined) return p;
  const miC=toNum(l.menuItem?.priceCents); if(miC!==undefined) return miC/100;
  const mi=toNum(l.menuItem?.price); if(mi!==undefined) return mi;
  const tC=toNum(l.totalCents), q=getQty(l);
  if(tC!==undefined && q>0){ const per=tC/100/q; const add=perUnitAddonsQ(l); return Math.max(0, per - add); }
  return 0;
}
function lineTotalQ(l:Line){
  if(toNum(l.lineTotal)!==undefined) return Number(l.lineTotal);
  if(toNum(l.totalCents)!==undefined) return Number(l.totalCents)/100;
  const q=getQty(l);
  return (baseUnitPriceQ(l)+perUnitAddonsQ(l))*q;
}

/** ---- NUEVO: encontrar líneas aunque vengan anidadas con otros nombres ---- */
function looksLikeLine(obj:any){
  if(!obj || typeof obj!=='object') return false;
  const hasName = 'menuItemName' in obj || 'name' in obj;
  const maybeQty = ('quantity' in obj) || ('addons' in obj) || ('optionGroups' in obj) || ('options' in obj);
  return !!(hasName && maybeQty);
}
function isLineArray(arr:any){
  return Array.isArray(arr) && arr.length>0 && arr.every((x)=> typeof x==='object');
}
function deepFindLines(root:any, maxDepth=4): Line[] | null {
  try{
    const visited = new Set<any>();
    const stack: Array<{v:any, d:number}> = [{v:root, d:0}];
    while(stack.length){
      const {v,d} = stack.pop()!;
      if(!v || typeof v!=='object' || visited.has(v)) continue;
      visited.add(v);

      // 1) casos obvios
      if (Array.isArray((v as any).items) && isLineArray((v as any).items) && (v as any).items.some(looksLikeLine)) {
        return (v as any).items as Line[];
      }
      if (Array.isArray((v as any).lines) && isLineArray((v as any).lines) && (v as any).lines.some(looksLikeLine)) {
        return (v as any).lines as Line[];
      }

      // 2) cualquier arreglo candidato
      for(const k of Object.keys(v)){
        const val = (v as any)[k];
        if (isLineArray(val) && (val as any[]).some(looksLikeLine)) {
          return val as Line[];
        }
      }

      // 3) seguir descendiendo
      if(d < maxDepth){
        for(const k of Object.keys(v)){
          const val = (v as any)[k];
          if (val && typeof val === 'object') stack.push({v:val, d:d+1});
        }
      }
    }
  }catch{}
  return null;
}

/** total de la orden con fallback a líneas si no hay amounts/totals */
function orderTotalQ(o:Order, fallbackLines?: Line[]){
  if(toNum(o.amounts?.total)!==undefined) return Number(o.amounts!.total);
  if(toNum(o.orderTotal)!==undefined) return Number(o.orderTotal);
  if(toNum(o.totals?.totalCents)!==undefined) return centsToQ(o.totals!.totalCents!);

  const linesA = (o.items||[]);
  if(linesA.length) return linesA.reduce((acc,l)=>acc+lineTotalQ(l),0);

  const linesB = (o.lines||[]);
  if(linesB.length) return linesB.reduce((acc,l)=>acc+lineTotalQ(l),0);

  if (fallbackLines?.length) return fallbackLines.reduce((acc,l)=>acc+lineTotalQ(l),0);

  return 0;
}

type NewLine = {
  menuItemId?: string; menuItemName?: string; basePrice?: number; quantity?: number;
  addons: Array<{ name: string; price?: number }>;
  optionGroups: Array<{ groupId: string; groupName: string; type?: 'single'|'multiple'; items: Array<{ id: string; name: string; priceDelta?: number }> }>;
  lineTotal?: number;
};

function EditOrderCartPageInner(){
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const key = storageKey(String(id));
  const [original, setOriginal] = useState<Order|null>(null);
  const [originalLines, setOriginalLines] = useState<Line[]|null>(null); // ← NUEVO
  const [pending, setPending] = useState<NewLine[]>([]);
  const [err, setErr] = useState<string|null>(null);

  // ✅ formateador global
  const fmtQ = useFmtQ();

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

  useEffect(()=>{ 
    let alive=true;
    (async()=>{
      try{
        setErr(null);
        const res = await apiFetch(`/api/orders/${id}`);
        let data: any = null;
        try { data = await res.json(); } catch(parseErr){
          console.error('Could not parse JSON from GET /api/orders/[id]', parseErr);
          setErr(tt('admin.editcart.err.nonJson', 'Invalid response from the server.'));
          return;
        }
        // Aceptar distintos formatos:
        const order: Order | null =
          data?.order ||
          data?.data ||
          data?.doc ||
          data?.item ||
          (Array.isArray(data?.items) ? data.items[0] : null) ||
          (Array.isArray(data?.orders) ? data.orders.find((o:any)=> String(o.id)===String(id)) || data.orders[0] : null) ||
          (data?.id ? data : null);

        if(res.ok && order && alive) {
          setOriginal(order);
          // NUEVO: buscar líneas donde estén
          const found = deepFindLines(order) || null;
          setOriginalLines(found);
          // log de diagnóstico (no afecta UI)
          console.debug('[edit-orders/cart] order id=%s, foundLines=%d', order.id || id, found?.length || 0, { orderSample: order, found });
        }
        if(!res.ok){
          setErr(data?.error || `Error ${res.status}`);
        } else if(!order){
          setErr(tt('admin.editcart.err.notFound', 'Order not found.'));
        }
      } catch(e:any){ 
        console.error(e); 
        setErr(e?.message || tt('admin.editcart.err.load', 'Error loading order'));
      }
      try{
        const arr: NewLine[] = JSON.parse(sessionStorage.getItem(key) || '[]');
        if(alive) setPending(arr);
      } catch {}
    })();
    return ()=>{alive=false};
  },[id]);

  const appendTotal = useMemo(()=> pending.reduce((acc,l)=>acc+(Number(l.lineTotal||0)),0),[pending]);

  async function confirmAppend(){
    if(!pending.length){ alert(tt('admin.editcart.err.noItems', 'There are no items to add.')); return; }
    const res = await apiFetch(`/api/orders/${id}/append`, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ items: pending }),
    });
    const data = await res.json().catch(()=> ({} as any));
    if(!res.ok || data?.ok===false){ alert(data?.error || `Error ${res.status}`); return; }
    sessionStorage.removeItem(key);
    alert(tt('admin.editcart.added.ok', 'The new items were added and the order was placed back in the Kitchen..'));
    const url = '/admin/edit-orders';
    // Mantener navegación existente
    window.location.assign(url);
  }

  const currency = original?.currency || 'USD';
  const origLines: Line[] = useMemo(()=>{
    // prioridad: items -> lines -> encontradas
    const A = (original?.items && original.items.length ? original.items : null);
    if (A) return A;
    const B = (original?.lines && original.lines.length ? original.lines : null);
    if (B) return B as Line[];
    return (originalLines || []) as Line[];
  },[original, originalLines]);

  const currentTotal = orderTotalQ(original || {}, origLines);

  return (
    <div className="container py-4">
      <h1 className="h5">{tt('admin.editcart.title', 'Edit Order')} #{String(id).slice(0,6)}</h1>

      {/* Orden original */}
      <div className="card border-0 shadow-sm mt-3">
        <div className="card-header"><div className="fw-semibold">{tt('admin.editcart.original.title', 'Original order')}</div></div>
        <div className="card-body">
          {!original && !err && <div className="text-muted">{tt('common.loadingOrder', 'Loading order…')}</div>}
          {err && <div className="text-danger small">{err}</div>}
          {original && (
            <>
              <div className="small text-muted mb-2">
                {tt('admin.editcart.original.currentTotal', 'Current total')}: {fmtQ(currentTotal)}
              </div>

              {origLines.length === 0 && (
                <div className="text-muted small">{tt('admin.editcart.original.noLines', 'No lines in this order.')}</div>
              )}

              {origLines.map((l,idx)=>{
                const name = getName(l);
                const qty = getQty(l);
                const base = baseUnitPriceQ(l);
                const sum = lineTotalQ(l);
                return (
                  <div key={idx} className="small mb-2 border-top pt-2">
                    <div className="d-flex justify-content-between">
                      <div>• {qty} × {name}</div>
                      <div className="text-muted">({fmtQ(base)} {tt('common.eachShort', 'c/u')})</div>
                    </div>

                    {Array.isArray(l.optionGroups) && l.optionGroups.map((g,gi)=>{
                      const rows = (g.items||[]).map((it,ii)=>{
                        const p = extractDeltaQ(it);
                        return <span key={ii}>{it?.name}{p?` (${fmtQ(p)})`:''}{ii<(g.items!.length-1)?', ':''}</span>;
                      });
                      return rows.length?(
                        <div key={gi} className="ms-3 text-muted">
                          <span className="fw-semibold">{g.groupName || tt('common.options', 'Options')}:</span> {rows}
                        </div>
                      ):null;
                    })}

                    {Array.isArray((l as any).options) && (l as any).options.map((g:any,gi:number)=>{
                      const rows = (g.selected||[]).map((it:any,ii:number)=>{
                        const p = extractDeltaQ(it);
                        return <span key={ii}>{it?.name}{p?` (${fmtQ(p)})`:''}{ii<(g.selected!.length-1)?', ':''}</span>;
                      });
                      return rows.length?(
                        <div key={`op-${gi}`} className="ms-3 text-muted">
                          <span className="fw-semibold">{g.groupName || tt('common.options', 'Options')}:</span> {rows}
                        </div>
                      ):null;
                    })}

                    {Array.isArray(l.addons) && l.addons.length>0 && (
                      <div className="ms-3 text-muted">
                        <span className="fw-semibold">{tt('common.addons', 'addons')}:</span>{' '}
                        {l.addons.map((ad:any,ai:number)=>{
                          if(typeof ad==='string') return <span key={ai}>{ad}{ai<l.addons!.length-1?', ':''}</span>;
                          const p = toNum(ad?.price) ?? (toNum(ad?.priceCents)!==undefined ? Number(ad!.priceCents)/100 : undefined);
                          return <span key={ai}>{ad?.name}{p?` (${fmtQ(p)})`:''}{ai<l.addons!.length-1?', ':''}</span>;
                        })}
                      </div>
                    )}

                    <div className="d-flex justify-content-between">
                      <span className="text-muted">{tt('admin.cashier.lineSubtotal', 'Subtotal line')}</span>
                      <span className="text-muted">{fmtQ(sum)}</span>
                    </div>
                  </div>
                );
              })}
            </>
          )}
        </div>
      </div>

      {/* Nuevos ítems */}
      <div className="card border-0 shadow-sm mt-4">
        <div className="card-header"><div className="fw-semibold">{tt('admin.editcart.new.title', 'New items to add')}</div></div>
        <div className="card-body">
          {pending.length===0 && <div className="text-muted">{tt('admin.editcart.new.empty', "You haven't added anything from the menu yet..")}</div>}
          {pending.map((l,idx)=>{
            const name = l.menuItemName || 'Ítem';
            const q = Number(l.quantity||1);
            const base = Number(l.basePrice||0);
            const sum = Number(l.lineTotal||0);
            return (
              <div key={idx} className="small mb-2 border-top pt-2">
                <div className="d-flex justify-content-between">
                  <div>• {q} × {name}</div>
                  <div className="text-muted">({fmtQ(base)} {tt('common.each', 'each')})</div>
                </div>

                {Array.isArray(l.optionGroups)&&l.optionGroups.map((g,gi)=>(
                  <div key={gi} className="ms-3 text-muted">
                    <span className="fw-semibold">{g.groupName||tt('common.options', 'Options')}:</span>{' '}
                    {(g.items||[]).map((it,ii)=> <span key={ii}>{it?.name}{it?.priceDelta?` (${fmtQ(it.priceDelta)})`:''}{ii<(g.items!.length-1)?', ':''}</span>)}
                  </div>
                ))}

                {Array.isArray(l.addons)&&l.addons.length>0 && (
                  <div className="ms-3 text-muted">
                    <span className="fw-semibold">{tt('common.addons', 'addons')}:</span>{' '}
                    {l.addons.map((ad:any,ai:number)=> <span key={ai}>{ad?.name}{ad?.price?` (${fmtQ(ad.price)})`:''}{ai<l.addons!.length-1?', ':''}</span>)}
                  </div>
                )}

                <div className="d-flex justify-content-between">
                  <span className="text-muted">{tt('admin.cashier.lineSubtotal', 'Subtotal line')}</span>
                  <span className="text-muted">{fmtQ(sum)}</span>
                </div>
              </div>
            );
          })}
        </div>
        <div className="card-footer d-flex justify-content-between align-items-center">
          <div>{tt('admin.editcart.footer.totalAdd', 'Total to add')}: <strong>{fmtQ(appendTotal)}</strong></div>
          <div className="d-flex gap-2">
            <button className="btn btn-outline-secondary" onClick={()=>{ sessionStorage.removeItem(key); setPending([]); }}>
              {tt('admin.editcart.footer.empty', 'Empty')}
            </button>
            <button className="btn btn-primary" onClick={confirmAppend} disabled={!pending.length}>
              {tt('admin.editcart.footer.continue', 'Continue')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* --------------------------------------------
   Export default: protegido por rol + plan
--------------------------------------------- */
export default function EditOrderCartPage(){
  return (
    <Protected>
      <RoleGate allow={['admin','waiter']}>
        <ToolGate feature="editOrders">
          <EditOrderCartPageInner />
        </ToolGate>
      </RoleGate>
    </Protected>
  );
}
