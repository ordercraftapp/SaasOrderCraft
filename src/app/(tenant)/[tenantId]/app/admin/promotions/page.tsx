// src/app/(tenant)/[tenantId]/app/admin/promotions/page.tsx
'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Protected from '@/app/(tenant)/[tenantId]/components/Protected';
import AdminOnly from '@/app/(tenant)/[tenantId]/components/AdminOnly';
import ToolGate from '@/components/ToolGate';
import { useTenantId } from '@/lib/tenant/context';
import { useFmtQ } from '@/lib/settings/money';

// 🔤 i18n
import { t as translate } from '@/lib/i18n/t';
import { useTenantSettings } from '@/lib/settings/hooks';

/* =========================================================================
   Firebase (cliente): Auth + Firestore (mantenemos inicialización segura)
   ========================================================================= */
function getFirebaseClientConfig() {
  return {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY!,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN!,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID!,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID!,
    storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  };
}
async function ensureFirebaseApp() {
  const app = await import('firebase/app');
  if (!app.getApps().length) {
    const cfg = getFirebaseClientConfig();
    if (cfg.apiKey && cfg.authDomain && cfg.projectId && cfg.appId) {
      app.initializeApp(cfg);
    } else {
      console.warn('[Firebase] Faltan variables NEXT_PUBLIC_* para inicializar el cliente.');
    }
  }
}
async function getAuthMod() {
  await ensureFirebaseApp();
  return await import('firebase/auth');
}
async function getFirestoreMod() {
  await ensureFirebaseApp();
  return await import('firebase/firestore');
}

function useAuthClaims() {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<any | null>(null);
  const [claims, setClaims] = useState<any | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      const { onAuthStateChanged, getAuth, getIdTokenResult } = await getAuthMod();
      const auth = getAuth();
      const unsub = onAuthStateChanged(auth, async (u) => {
        if (!alive) return;
        setUser(u ?? null);
        if (u) {
          try {
            // AUTHZ-FIX: refrescar token para traer claims por-tenant actualizados
            await u.getIdToken(true);
            const r = await getIdTokenResult(u);
            setClaims(r.claims || null);
          } catch {
            setClaims(null);
          }
        } else {
          setClaims(null);
        }
        setAuthReady(true);
      });
      return () => unsub();
    })();
    return () => { alive = false; };
  }, []);

  return { authReady, user, claims, isAdminGlobal: !!(claims && claims.admin) } as const;
}


/* =========================================================================
   Tipos según tus colecciones actuales
   ========================================================================= */
export type Category = {
  id: string;
  name: string;
  slug?: string;
  isActive?: boolean;
  sortOrder?: number;
  imageUrl?: string | null;
};
export type Subcategory = {
  id: string;
  name: string;
  categoryId: string;
  isActive?: boolean;
  sortOrder?: number;
  imageUrl?: string | null;
};
export type MenuItem = {
  id: string;
  name: string;
  price: number; // GTQ
  categoryId: string;
  subcategoryId: string;
  active?: boolean;
  imageUrl?: string | null;
  description?: string | null;
};

export type Promotion = {
  id: string;
  tenantId?: string; // ✅ siempre persistimos tenantId en escrituras
  name: string;
  code: string; // UPPERCASE y único lógico POR TENANT
  type: 'percent' | 'fixed';
  value: number; // percent: 1-100; fixed: GTQ
  active: boolean;
  secret?: boolean; // visible para clientes
  startAt?: any | null; // Timestamp/Date
  endAt?: any | null;
  scope?: {
    categories?: string[];
    subcategories?: string[];
    menuItems?: string[];
  };
  constraints?: {
    minTargetSubtotal?: number;
    allowedOrderTypes?: Array<'dine_in' | 'delivery' | 'takeaway'>;
    globalLimit?: number;
    perUserLimit?: number;
    stackable?: boolean;
    autoApply?: boolean;
  };
  timesRedeemed?: number;
  createdAt?: any;
  updatedAt?: any;
};

/* =========================================================================
   Utils
   ========================================================================= */
function normalizeCode(s: string) {
  return (s || '').trim().toUpperCase().replace(/\s+/g, '');
}
function removeUndefinedDeep<T>(obj: T): T {
  if (obj === undefined || obj === null) return obj as any;
  if (Array.isArray(obj)) return obj.map((v) => removeUndefinedDeep(v)).filter((v) => v !== undefined) as any;
  if (typeof obj === 'object') {
    const isDate = obj instanceof Date || typeof (obj as any).toDate === 'function';
    if (isDate) return obj as any;
    const out: any = {};
    Object.entries(obj as any).forEach(([k, v]) => {
      const cleaned = removeUndefinedDeep(v as any);
      if (cleaned !== undefined) out[k] = cleaned;
    });
    return out;
  }
  return obj as any;
}

/* =========================================================================
   Firestore helpers (tenant‑scoped)
   ========================================================================= */
async function createDocScoped(tenantId: string, collName: string, data: any): Promise<string> {
  const { getFirestore, collection, addDoc, serverTimestamp } = await getFirestoreMod();
  const db = getFirestore();
  const ref = await addDoc(collection(db, `tenants/${tenantId}/${collName}`), {
    ...data,
    tenantId,
    createdAt: serverTimestamp?.(),
    updatedAt: serverTimestamp?.(),
  });
  return ref.id;
}
async function updateDocByIdScoped(tenantId: string, collName: string, id: string, data: any) {
  const { getFirestore, doc, updateDoc, serverTimestamp } = await getFirestoreMod();
  const db = getFirestore();
  await updateDoc(doc(db, `tenants/${tenantId}/${collName}/${id}`), { ...data, tenantId, updatedAt: serverTimestamp?.() });
}
async function deleteDocByIdScoped(tenantId: string, collName: string, id: string) {
  const { getFirestore, doc, deleteDoc } = await getFirestoreMod();
  const db = getFirestore();
  await deleteDoc(doc(db, `tenants/${tenantId}/${collName}/${id}`));
}

/* =========================================================================
   Página /admin/promotions (UI + lógica)
   ========================================================================= */
function AdminPromotionsPage_Inner() {
  const tenantId = useTenantId();
  const { authReady, user, claims, isAdminGlobal } = useAuthClaims();

  // AUTHZ-FIX: admin por tenant (o admin global)
  const isAdminAtTenant = useMemo(() => {
    if (!claims || !tenantId) return false;
    const roles = claims.tenants?.[tenantId]?.roles;
    return Boolean(isAdminGlobal || (Array.isArray(roles) && roles.includes('admin')));
  }, [claims, tenantId, isAdminGlobal]);
  const fmtQ = useFmtQ();

  // 🔤 idioma
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

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Catálogo para “scope”
  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);

  // Promociones
  const [promos, setPromos] = useState<Promotion[]>([]);
  const [search, setSearch] = useState('');

  // Formulario
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [type, setType] = useState<'percent' | 'fixed'>('percent');
  const [value, setValue] = useState<string>('');
  const [active, setActive] = useState(true);
  const [secret, setSecret] = useState<boolean>(false);
  const [startAt, setStartAt] = useState<string>('');
  const [endAt, setEndAt] = useState<string>('');

  // Alcance
  const [scopeCats, setScopeCats] = useState<string[]>([]);
  const [scopeSubs, setScopeSubs] = useState<string[]>([]);
  const [scopeItems, setScopeItems] = useState<string[]>([]);

  // Reglas
  const [minTargetSubtotal, setMinTargetSubtotal] = useState<string>('');
  const [allowedOrderTypes, setAllowedOrderTypes] = useState<Array<'dine_in' | 'delivery' | 'takeaway'>>([]);
  const [globalLimit, setGlobalLimit] = useState<string>('');
  const [perUserLimit, setPerUserLimit] = useState<string>('');
  const [stackable, setStackable] = useState<boolean>(false);
  const [autoApply, setAutoApply] = useState<boolean>(false);

  // Filtros de ayuda para listar ítems
  const [filterCat, setFilterCat] = useState<string>('');
  const [filterSub, setFilterSub] = useState<string>('');

  const itemsFiltered = useMemo(() => {
    return items.filter((mi) => {
      if (filterCat && mi.categoryId !== filterCat) return false;
      if (filterSub && mi.subcategoryId !== filterSub) return false;
      return true;
    });
  }, [items, filterCat, filterSub]);

  // Suscripciones en tiempo real (SCOPED)
  useEffect(() => {
    let unsubCats: any, unsubSubs: any, unsubItems: any, unsubPromos: any;
    (async () => {
      if (!tenantId) { setLoading(false); setErr('Missing tenantId'); return; }
      if (!(user && isAdminAtTenant)) { setLoading(false); return; }
      try {
        setLoading(true);
        setErr(null);
        const { getFirestore, collection, onSnapshot, query, orderBy } = await getFirestoreMod();
        const db = getFirestore();

        // categories
        try {
          unsubCats = onSnapshot(
            query(collection(db, `tenants/${tenantId}/categories`), orderBy('sortOrder', 'asc')),
            (snap) => {
              const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
              setCategories(rows as Category[]);
            }
          );
        } catch {
          unsubCats = onSnapshot(collection(db, `tenants/${tenantId}/categories`), (snap) => {
            const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
            rows.sort((a: any, b: any) => String(a?.name || '').localeCompare(String(b?.name || '')));
            setCategories(rows as Category[]);
          });
        }

        // subcategories
        try {
          unsubSubs = onSnapshot(
            query(collection(db, `tenants/${tenantId}/subcategories`), orderBy('sortOrder', 'asc')),
            (snap) => {
              const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
              setSubcategories(rows as Subcategory[]);
            }
          );
        } catch {
          unsubSubs = onSnapshot(collection(db, `tenants/${tenantId}/subcategories`), (snap) => {
            const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
            rows.sort((a: any, b: any) => String(a?.name || '').localeCompare(String(b?.name || '')));
            setSubcategories(rows as Subcategory[]);
          });
        }

        // menuItems
        unsubItems = onSnapshot(collection(db, `tenants/${tenantId}/menuItems`), (snap) => {
          const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
          rows.sort((a: any, b: any) => String(a?.name || '').localeCompare(String(b?.name || '')));
          setItems(rows as MenuItem[]);
        });

        // promotions
        unsubPromos = onSnapshot(collection(db, `tenants/${tenantId}/promotions`), (snap) => {
          const rows = snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
          rows.sort((a: any, b: any) => String(a?.name || '').localeCompare(String(b?.name || '')));
          setPromos(rows as Promotion[]);
        });
      } catch (e: any) {
        setErr(e?.message || tt('admin.promos.err.loading', 'Error loading data'));
      } finally {
        setLoading(false);
      }
    })();

    return () => {
      try { unsubCats && unsubCats(); } catch {}
      try { unsubSubs && unsubSubs(); } catch {}
      try { unsubItems && unsubItems(); } catch {}
      try { unsubPromos && unsubPromos(); } catch {}
    };
  }, [tenantId, user, isAdminAtTenant]);

  /* =========================================================================
     Guardar / Editar / Borrar (SCOPED)
     ========================================================================= */
  async function isCodeTaken(codeUpper: string, ignoreId?: string) {
    const { getFirestore, collection, query, where, getDocs, limit } = await getFirestoreMod();
    const db = getFirestore();
    const q = query(
      collection(db, `tenants/${tenantId}/promotions`),
      where('code', '==', codeUpper),
      limit(1)
    );
    const snap = await getDocs(q);
    if (snap.empty) return false;
    const doc0 = snap.docs[0];
    return doc0.id !== ignoreId;
  }

  async function onSavePromotion() {
    try {
      if (!tenantId) throw new Error('Missing tenantId');

      const nameV = name.trim();
      if (!nameV) {
        alert(tt('admin.promos.alert.nameRequired', 'Promotion name is required'));
        return;
      }

      const codeV = normalizeCode(code);
      if (!codeV) {
        alert(tt('admin.promos.alert.codeRequired', 'Code is required'));
        return;
      }

      // normalización del valor
      let valN = Number(String(value).replace(',', '.'));
      if (!Number.isFinite(valN) || valN <= 0) {
        alert(
          type === 'percent'
            ? tt('admin.promos.alert.invalidPct', 'Invalid percentage')
            : tt('admin.promos.alert.invalidAmt', 'Invalid amount')
        );
        return;
      }
      if (type === 'percent') {
        valN = Math.round(valN * 100) / 100;
        const near = Math.round(valN);
        if (Math.abs(valN - near) < 0.05) valN = near;
        if (valN <= 0 || valN > 100) {
          alert(tt('admin.promos.alert.pctRange', 'Percentage must be 1–100'));
          return;
        }
      } else {
        valN = Math.round(valN * 100) / 100;
      }

      // unicidad de código por tenant
      if (await isCodeTaken(codeV, editingId || undefined)) {
        alert(tt('admin.promos.alert.codeExists', 'That code already exists. Use another one.'));
        return;
      }

      // Alcance (vacío => aplica a todo)
      const scopeRaw: Promotion['scope'] = {
        categories: scopeCats.length ? scopeCats : undefined,
        subcategories: scopeSubs.length ? scopeSubs : undefined,
        menuItems: scopeItems.length ? scopeItems : undefined,
      };

      // Fechas
      const startDate = startAt ? new Date(startAt) : undefined;
      const endDate = endAt ? new Date(endAt) : undefined;

      // Reglas
      const constraintsRaw: Promotion['constraints'] = {
        minTargetSubtotal: minTargetSubtotal ? Number(minTargetSubtotal) : undefined,
        allowedOrderTypes: allowedOrderTypes.length ? allowedOrderTypes : undefined,
        globalLimit: globalLimit ? Number(globalLimit) : undefined,
        perUserLimit: perUserLimit ? Number(perUserLimit) : undefined,
        stackable: stackable || undefined,
        autoApply: autoApply || undefined,
      };

      const scope = removeUndefinedDeep(scopeRaw) || {};
      const constraints = removeUndefinedDeep(constraintsRaw) || {};

      const payloadRaw: Partial<Promotion> = {
        name: nameV,
        code: codeV,
        type,
        value: valN!,
        active: !!active,
        secret: !!secret,
        startAt: startDate || null,
        endAt: endDate || null,
        scope,
        constraints,
      };

      const payload: any = removeUndefinedDeep(payloadRaw);
      if (payload.scope && Object.keys(payload.scope).length === 0) delete payload.scope;
      if (payload.constraints && Object.keys(payload.constraints).length === 0) delete payload.constraints;

      if (!editingId) {
        const newId = await createDocScoped(tenantId, 'promotions', payload);
        await updateDocByIdScoped(tenantId, 'promotions', newId, { id: newId, timesRedeemed: 0 });
      } else {
        await updateDocByIdScoped(tenantId, 'promotions', editingId, payload);
      }

      resetForm();
      alert(tt('admin.promos.alert.saved', 'Promotion saved.'));
    } catch (e: any) {
      alert(e?.message || tt('admin.promos.alert.saveError', 'Could not save the promotion'));
    }
  }

  async function onDeletePromotion(id: string) {
    if (!confirm(tt('admin.promos.confirm.delete', 'Delete this promotion?'))) return;
    try {
      if (!tenantId) throw new Error('Missing tenantId');
      await deleteDocByIdScoped(tenantId, 'promotions', id);
    } catch (e: any) {
      alert(e?.message || tt('admin.promos.alert.deleteError', 'Could not delete the promotion'));
    }
  }

  function resetForm() {
    setEditingId(null);
    setName('');
    setCode('');
    setType('percent');
    setValue('');
    setActive(true);
    setSecret(false);
    setStartAt('');
    setEndAt('');
    setScopeCats([]);
    setScopeSubs([]);
    setScopeItems([]);
    setMinTargetSubtotal('');
    setAllowedOrderTypes([]);
    setGlobalLimit('');
    setPerUserLimit('');
    setStackable(false);
    setAutoApply(false);
  }

  function onEditPromotion(p: Promotion) {
    setEditingId(p.id);
    setName(p.name || '');
    setCode(p.code || '');
    setType((p.type as any) || 'percent');
    setValue(typeof p.value === 'number' ? String(p.value) : '');
    setActive(p.active !== false);
    setSecret(!!p.secret);

    const toLocalStr = (d: any) => {
      if (!d) return '';
      const dt = typeof d?.toDate === 'function' ? d.toDate() : d instanceof Date ? d : new Date(d);
      const pad = (n: number) => String(n).padStart(2, '0');
      const yyyy = dt.getFullYear();
      const mm = pad(dt.getMonth() + 1);
      const dd = pad(dt.getDate());
      const hh = pad(dt.getHours());
      const mi = pad(dt.getMinutes());
      return `${yyyy}-${mm}-${dd}T${hh}:${mi}`;
    };
    setStartAt(p.startAt ? toLocalStr(p.startAt) : '');
    setEndAt(p.endAt ? toLocalStr(p.endAt) : '');

    setScopeCats(p.scope?.categories || []);
    setScopeSubs(p.scope?.subcategories || []);
    setScopeItems(p.scope?.menuItems || []);

    setMinTargetSubtotal(
      p.constraints?.minTargetSubtotal != null ? String(p.constraints!.minTargetSubtotal) : ''
    );
    setAllowedOrderTypes(p.constraints?.allowedOrderTypes || []);
    setGlobalLimit(p.constraints?.globalLimit != null ? String(p.constraints!.globalLimit) : '');
    setPerUserLimit(p.constraints?.perUserLimit != null ? String(p.constraints!.perUserLimit) : '');
    setStackable(!!p.constraints?.stackable);
    setAutoApply(!!p.constraints?.autoApply);
  }

  /* =========================================================================
     UI helpers
     ========================================================================= */
  function scopeSummary(p: Promotion) {
    const cats = p.scope?.categories?.length || 0;
    const subs = p.scope?.subcategories?.length || 0;
    const mis = p.scope?.menuItems?.length || 0;
    if (!cats && !subs && !mis) return tt('admin.promos.scope.all', 'All items');
    const parts: string[] = [];
    if (cats) parts.push(tt('admin.promos.scope.cats', '{n} category(ies)', { n: cats }));
    if (subs) parts.push(tt('admin.promos.scope.subs', '{n} subcat(s)', { n: subs }));
    if (mis) parts.push(tt('admin.promos.scope.items', '{n} dish(es)', { n: mis }));
    return parts.join(' · ');
  }
  function discountSummary(p: Promotion) {
    return p.type === 'percent' ? `${p.value}%` : `${fmtQ(p.value)} ${tt('admin.promos.fixed', 'fixed')}`;
  }
  function ruleSummary(p: Promotion) {
    const arr: string[] = [];
    if (p.constraints?.minTargetSubtotal) arr.push(`${tt('admin.promos.rule.min', 'min')} ${fmtQ(p.constraints.minTargetSubtotal)}`);
    if (p.constraints?.allowedOrderTypes?.length) arr.push(p.constraints.allowedOrderTypes.join('/'));
    if (p.constraints?.globalLimit != null) arr.push(`${tt('admin.promos.rule.global', 'global limit')}: ${p.constraints.globalLimit}`);
    if (p.constraints?.perUserLimit != null) arr.push(`${tt('admin.promos.rule.user', 'user limit')}: ${p.constraints.perUserLimit}`);
    if (p.constraints?.stackable) arr.push(tt('admin.promos.rule.stackable', 'stackable'));
    if (p.constraints?.autoApply) arr.push(tt('admin.promos.rule.auto', 'auto'));
    return arr.join(' · ') || '—';
  }

  const promosFiltered = useMemo(() => {
    const q = (search || '').toLowerCase().trim();
    if (!q) return promos;
    return promos.filter((p) => (p.name || '').toLowerCase().includes(q) || (p.code || '').toLowerCase().includes(q));
  }, [promos, search]);

  /* =========================================================================
     Render
     ========================================================================= */
  if (!authReady) return <div className="container py-3">{tt('admin.common.initializing', 'Initializing session…')}</div>;
  if (!user) return <div className="container py-5 text-danger">{tt('admin.common.mustSignIn', 'You must sign in.')}</div>;
  if (!tenantId) return <div className="container py-5 text-danger">{tt('admin.common.missingTenant', 'Missing tenant context.')}</div>;
  if (!isAdminAtTenant) return <div className="container py-5 text-danger">{tt('admin.common.unauthorized', 'Unauthorized (admins only).')}</div>;


  return (
    <div className="container py-3">
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h1 className="h4 m-0">{tt('admin.promos.title', 'Promotions — Discount Codes')}</h1>
        <span className="text-muted small">{tt('admin.promos.realtime', 'Real-time updates')}</span>
      </div>
      {err && <div className="alert alert-danger">{err}</div>}

      <div className="row g-3">
        {/* ===================== Columna izquierda: Crear/Editar ===================== */}
        <div className="col-12 col-lg-5">
          <div className="card">
            <div className="card-header d-flex align-items-center justify-content-between">
              <span>{editingId ? tt('admin.promos.form.editTitle', 'Edit promotion') : tt('admin.promos.form.createTitle', 'Create promotion')}</span>
              {editingId && (
                <button className="btn btn-sm btn-outline-secondary" onClick={resetForm}>
                  {tt('admin.promos.form.new', 'New')}
                </button>
              )}
            </div>
            <div className="card-body">
              {/* Básicos */}
              <div className="mb-2">
                <label className="form-label">{tt('admin.promos.form.name', 'Name (visible to customer)')}</label>
                <input className="form-control" value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="row g-2">
                <div className="col-8">
                  <label className="form-label">{tt('admin.promos.form.code', 'Code')}</label>
                  <input
                    className="form-control"
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    placeholder={tt('admin.promos.form.codePh', 'e.g., DESSERTS10')}
                  />
                </div>
                <div className="col-4 d-flex align-items-end">
                  <div className="form-check">
                    <input className="form-check-input" type="checkbox" id="act" checked={active} onChange={(e) => setActive(e.target.checked)} />
                    <label className="form-check-label" htmlFor="act">{tt('admin.promos.form.active', 'Active')}</label>
                  </div>
                </div>
              </div>

              {/* 🔹 Secret */}
              <div className="mt-2">
                <div className="form-check">
                  <input className="form-check-input" type="checkbox" id="secret" checked={secret} onChange={(e) => setSecret(e.target.checked)} />
                  <label className="form-check-label" htmlFor="secret">
                    {tt('admin.promos.form.secret', 'Secret coupon (hide from customer lists)')}
                  </label>
                </div>
                <div className="form-text">
                  {tt('admin.promos.form.secretHelp', "Customers won’t see this code in the promotions section, but it can still be applied manually at checkout.")}
                </div>
              </div>

              <div className="row g-2 mt-3">
                <div className="col-6">
                  <label className="form-label">{tt('admin.promos.form.type', 'Discount type')}</label>
                  <select className="form-select" value={type} onChange={(e) => setType(e.target.value as any)}>
                    <option value="percent">{tt('admin.promos.form.type.percent', '% percent')}</option>
                    <option value="fixed">{tt('admin.promos.form.type.fixed', 'Q fixed amount')}</option>
                  </select>
                </div>
                <div className="col-6">
                  <label className="form-label">
                    {type === 'percent' ? tt('admin.promos.form.valuePct', 'Percentage (1–100)') : tt('admin.promos.form.valueAmt', 'Amount (GTQ)')}
                  </label>
                  <input type="number" step="0.01" className="form-control" value={value} onChange={(e) => setValue(e.target.value)} />
                </div>
              </div>

              <div className="row g-2 mt-2">
                <div className="col-6">
                  <label className="form-label">{tt('admin.promos.form.start', 'Start (optional)')}</label>
                  <input type="datetime-local" className="form-control" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
                </div>
                <div className="col-6">
                  <label className="form-label">{tt('admin.promos.form.end', 'End (optional)')}</label>
                  <input type="datetime-local" className="form-control" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
                </div>
              </div>

              <hr className="my-3" />
              {/* Alcance */}
              <div className="d-flex align-items-center justify-content-between mb-2">
                <strong>{tt('admin.promos.scope.title', 'Scope (what does it apply to?)')}</strong>
                <button type="button" className="btn btn-sm btn-outline-secondary" onClick={() => { setScopeCats([]); setScopeSubs([]); setScopeItems([]); }}>
                  {tt('admin.promos.scope.clear', 'Clear selection')}
                </button>
              </div>

              <div className="row g-2">
                <div className="col-12 col-md-4">
                  <div className="border rounded p-2" style={{ maxHeight: 180, overflow: 'auto' }}>
                    <div className="fw-semibold small mb-1">{tt('admin.promos.scope.categories', 'Categories')}</div>
                    {categories.length === 0 && <div className="text-muted small">{tt('admin.promos.none.categories', 'No categories.')}</div>}
                    {categories.map((c) => {
                      const checked = scopeCats.includes(c.id);
                      return (
                        <label key={c.id} className="form-check small d-flex align-items-center gap-1">
                          <input
                            className="form-check-input"
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const v = e.currentTarget.checked;
                              setScopeCats((prev) => (v ? [...new Set([...prev, c.id])] : prev.filter((x) => x !== c.id)));
                            }}
                          />
                          <span className="text-truncate">{c.name}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="col-12 col-md-4">
                  <div className="border rounded p-2" style={{ maxHeight: 180, overflow: 'auto' }}>
                    <div className="fw-semibold small mb-1">{tt('admin.promos.scope.subcategories', 'Subcategories')}</div>
                    {subcategories.length === 0 && <div className="text-muted small">{tt('admin.promos.none.subcategories', 'No subcategories.')}</div>}
                    {subcategories.map((s) => {
                      const checked = scopeSubs.includes(s.id);
                      const catName = categories.find((c) => c.id === s.categoryId)?.name || '—';
                      return (
                        <label key={s.id} className="form-check small d-flex align-items-center gap-1">
                          <input
                            className="form-check-input"
                            type="checkbox"
                            checked={checked}
                            onChange={(e) => {
                              const v = e.currentTarget.checked;
                              setScopeSubs((prev) => (v ? [...new Set([...prev, s.id])] : prev.filter((x) => x !== s.id)));
                            }}
                          />
                          <span className="text-truncate">
                            {s.name} <span className="text-muted">({catName})</span>
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="col-12 col-md-4">
                  <div className="border rounded p-2">
                    <div className="d-flex align-items-center justify-content-between">
                      <div className="fw-semibold small">{tt('admin.promos.scope.dishes', 'Dishes')}</div>
                      <div className="d-flex gap-2">
                        <select
                          className="form-select form-select-sm"
                          style={{ width: 160 }}
                          value={filterCat}
                          onChange={(e) => {
                            setFilterCat(e.target.value);
                            setFilterSub('');
                          }}
                        >
                          <option value="">{tt('admin.promos.scope.allCategories', '(All categories)')}</option>
                          {categories.map((c) => (
                            <option key={c.id} value={c.id}>
                              {c.name}
                            </option>
                          ))}
                        </select>
                        <select
                          className="form-select form-select-sm"
                          style={{ width: 160 }}
                          value={filterSub}
                          onChange={(e) => setFilterSub(e.target.value)}
                        >
                          <option value="">{tt('admin.promos.scope.allSubcategories', '(All subcategories)')}</option>
                          {subcategories
                            .filter((s) => !filterCat || s.categoryId === filterCat)
                            .map((s) => (
                              <option key={s.id} value={s.id}>
                                {s.name}
                              </option>
                            ))}
                        </select>
                      </div>
                    </div>

                    <div style={{ maxHeight: 180, overflow: 'auto' }} className="mt-2">
                      {itemsFiltered.length === 0 && <div className="text-muted small">{tt('admin.promos.none.dishes', 'No dishes.')}</div>}
                      {itemsFiltered.map((mi) => {
                        const checked = scopeItems.includes(mi.id);
                        const cName = categories.find((c) => c.id === mi.categoryId)?.name || '—';
                        const sName = subcategories.find((s) => s.id === mi.subcategoryId)?.name || '—';
                        return (
                          <label key={mi.id} className="form-check small d-flex align-items-center gap-1">
                            <input
                              className="form-check-input"
                              type="checkbox"
                              checked={checked}
                              onChange={(e) => {
                                const v = e.currentTarget.checked;
                                setScopeItems((prev) => (v ? [...new Set([...prev, mi.id])] : prev.filter((x) => x !== mi.id)));
                              }}
                            />
                            <span className="text-truncate">
                              {mi.name} <span className="text-muted">({cName} · {sName})</span>
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                </div>
              </div>

              <hr className="my-3" />
              {/* Reglas */}
              <strong>{tt('admin.promos.rules.title', 'Rules')}</strong>
              <div className="row g-2 mt-1">
                <div className="col-6">
                  <label className="form-label">{tt('admin.promos.rules.minSubtotal', 'Min. eligible subtotal ')}</label>
                  <input type="number" step="0.01" className="form-control" value={minTargetSubtotal} onChange={(e) => setMinTargetSubtotal(e.target.value)} />
                </div>
                <div className="col-6">
                  <label className="form-label">{tt('admin.promos.rules.allowedTypes', 'Allowed order types')}</label>
                  <div className="d-flex flex-wrap gap-3 border rounded p-2">
                    {(['dine_in', 'delivery', 'takeaway'] as const).map((t) => (
                      <label key={t} className="form-check">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          checked={allowedOrderTypes.includes(t)}
                          onChange={(e) => {
                            const v = e.currentTarget.checked;
                            setAllowedOrderTypes((prev) => (v ? [...new Set([...prev, t])] : prev.filter((x) => x !== t)));
                          }}
                        />
                        <span className="form-check-label text-capitalize ms-1">{t.replace('_', ' ')}</span>
                      </label>
                    ))}
                  </div>
                </div>

                <div className="col-6">
                  <label className="form-label">{tt('admin.promos.rules.globalLimit', 'Global usage limit')}</label>
                  <input type="number" className="form-control" value={globalLimit} onChange={(e) => setGlobalLimit(e.target.value)} />
                </div>
                <div className="col-6">
                  <label className="form-label">{tt('admin.promos.rules.userLimit', 'Per-user limit')}</label>
                  <input type="number" className="form-control" value={perUserLimit} onChange={(e) => setPerUserLimit(e.target.value)} />
                </div>

                <div className="col-6 d-flex align-items-end">
                  <div className="form-check">
                    <input className="form-check-input" type="checkbox" id="stack" checked={stackable} onChange={(e) => setStackable(e.target.checked)} />
                    <label className="form-check-label" htmlFor="stack">{tt('admin.promos.rules.stackable', 'Stackable (stackable)')}</label>
                  </div>
                </div>
                <div className="col-6 d-flex align-items-end">
                  <div className="form-check">
                    <input className="form-check-input" type="checkbox" id="auto" checked={autoApply} onChange={(e) => setAutoApply(e.target.checked)} />
                    <label className="form-check-label" htmlFor="auto">{tt('admin.promos.rules.autoApply', 'Auto-apply (autoApply)')}</label>
                  </div>
                </div>
              </div>

              <div className="text-end mt-3">
                <button className="btn btn-primary" onClick={onSavePromotion}>
                  {editingId ? tt('admin.promos.btn.saveChanges', 'Save changes') : tt('admin.promos.btn.create', 'Create promotion')}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* ===================== Columna derecha: Listado ===================== */}
        <div className="col-12 col-lg-7">
          <div className="card">
            <div className="card-header d-flex align-items-center justify-content-between">
              <span>{tt('admin.promos.list.title', 'Existing promotions')}</span>
              <input
                className="form-control form-control-sm"
                style={{ maxWidth: 240 }}
                placeholder={tt('admin.promos.list.searchPh', 'Search by name or code…')}
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <div className="card-body">
              {promosFiltered.length === 0 && <div className="text-muted small">{tt('admin.promos.none.promos', 'No promotions.')}</div>}
              <div className="row g-3">
                {promosFiltered.map((p) => {
                  const toStr = (d: any) => {
                    if (!d) return '—';
                    const dt = typeof d?.toDate === 'function' ? d.toDate() : d instanceof Date ? d : new Date(d);
                    return dt.toLocaleString();
                  };
                  return (
                    <div key={p.id} className="col-12">
                      <div className="card h-100">
                        <div className="card-body">
                          <div className="d-flex justify-content-between align-items-start">
                            <div>
                              <div className="fw-semibold">
                                {p.name}{' '}
                                {p.secret ? (
                                  <span className="badge text-bg-warning align-middle ms-1">{tt('admin.promos.badge.secret', 'secret')}</span>
                                ) : null}
                              </div>
                              <div className="text-muted small">
                                {tt('admin.promos.code', 'Code')}: <strong>{p.code}</strong> · {discountSummary(p)} ·{' '}
                                {p.active ? (
                                  <span className="badge text-bg-success">{tt('admin.promos.badge.active', 'active')}</span>
                                ) : (
                                  <span className="badge text-bg-secondary">{tt('admin.promos.badge.inactive', 'inactive')}</span>
                                )}
                              </div>
                              <div className="text-muted small mt-1">
                                {tt('admin.promos.scope.label', 'Scope')}: {scopeSummary(p)}
                              </div>
                              <div className="text-muted small">{tt('admin.promos.rules.label', 'Rules')}: {ruleSummary(p)}</div>
                              <div className="text-muted small">{tt('admin.promos.validity', 'Validity')}: {toStr(p.startAt)} → {toStr(p.endAt)}</div>
                              <div className="text-muted small">{tt('admin.promos.uses', 'Uses')}: {typeof p.timesRedeemed === 'number' ? p.timesRedeemed : 0}</div>
                            </div>
                            <div className="d-flex flex-column gap-2 align-items-stretch" style={{ minWidth: 160 }}>
                              <button className="btn btn-outline-secondary btn-sm w-100" onClick={() => onEditPromotion(p)}>
                                {tt('admin.promos.btn.edit', 'Edit')}
                              </button>
                              <button className="btn btn-outline-danger btn-sm w-100" onClick={() => onDeletePromotion(p.id)}>
                                {tt('admin.promos.btn.delete', 'Delete')}
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          <div className="alert alert-light border mt-3 small">
            <strong>{tt('admin.promos.note.title', 'Note')}:</strong>{' '}
            {tt(
              'admin.promos.note.body',
              "This page only manages promotion metadata. In the checkout we’ll add a code field and an endpoint that calculates the discount only over eligible items (by category, subcategory, or dish). I haven’t touched the checkout yet."
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function AdminPromotionsPage() {
  return (
    
      <AdminOnly>
        <ToolGate feature="promotions">
          <AdminPromotionsPage_Inner />
        </ToolGate>
      </AdminOnly>
    
  );
}
