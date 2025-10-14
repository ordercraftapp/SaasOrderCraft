// src/app/(tenant)/[tenantId]/app/admin/menu/page.tsx
'use client';

import React, { useEffect, useMemo, useState } from 'react';

/** ✅ Guards UI */
import Protected from '@/app/(tenant)/[tenantId]/components/Protected';
import AdminOnly from '@/app/(tenant)/[tenantId]/components/AdminOnly';
import ToolGate from '@/components/ToolGate';

/** ✅ Firebase (cliente) bootstrap centralizado */
import '@/lib/firebase/client';

/** 🔁 Currency centralizado */
import { useFmtQ } from '@/lib/settings/money';

/* 🔤 i18n */
import { t as translate } from "@/lib/i18n/t";
import { useTenantSettings } from "@/lib/settings/hooks";

/** ✅ Tenant context (Phase C) */
import { useTenantId } from '@/lib/tenant/context';

/** ✅ Firestore helpers tenant-aware (Web SDK) */
import { tCol, tDoc } from '@/lib/db';

/** ✅ Firebase Web SDK (dinámico para CSR) */
async function getFirestoreMod() {
  return await import('firebase/firestore');
}
async function getStorageMod() {
  return await import('firebase/storage');
}

/* =========================================================================
   Auth (solo para reflejar isAdmin como tenías antes)  ⬅️ ACTUALIZADO
   ========================================================================= */
async function getAuthMod() {
  return await import('firebase/auth');
}

function useAuthClaims(tenantId?: string) {
  const [authReady, setAuthReady] = useState(false);
  const [user, setUser] = useState<any | null>(null);
  const [claims, setClaims] = useState<any | null>(null);

  // ➕ estado extra para rol resuelto por el backend del tenant
  const [serverRole, setServerRole] = useState<string | null>(null);
  const [loadingRole, setLoadingRole] = useState(false);

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
            const r = await getIdTokenResult(u);
            setClaims(r.claims || null);
          } catch {
            setClaims(null);
          }
        } else {
          setClaims(null);
          setServerRole(null);
        }
        setAuthReady(true);
      });
      return () => unsub();
    })();
    return () => { alive = false; };
  }, []);

  // 🔄 refresca rol tenant-aware (usa cookie/appRole o JSON { role })
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!tenantId || !user) return;
        setLoadingRole(true);
        const idToken = await user.getIdToken(true);
        const resp = await fetch(`/${tenantId}/app/api/auth/refresh-role`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${idToken}` },
          cache: 'no-store',
        });
        const data = await resp.json().catch(() => ({}));
        if (!alive) return;
        if (resp.ok && data?.ok === true && typeof data.role === 'string') {
          setServerRole(String(data.role).toLowerCase());
        }
      } catch {
        // silencioso
      } finally {
        if (alive) setLoadingRole(false);
      }
    })();
    return () => { alive = false; };
  }, [tenantId, user]);

  return {
    // auth listo cuando Firebase listo y, si aplica, terminó el refresh de rol
    authReady: authReady && !loadingRole,
    user,
    // ✅ Admin si: custom claim global o serverRole === 'admin'
    isAdmin: !!claims?.admin || serverRole === 'admin',
  } as const;
}


/* =========================================================================
   Tipos (Firestore)
   ========================================================================= */
type Category = {
  id: string;
  name: string;
  slug?: string;
  description?: string;
  isActive?: boolean;
  sortOrder?: number;
  imageUrl?: string | null;
  imagePath?: string | null;
  tenantId?: string;
};

type Subcategory = {
  id: string;
  name: string;
  categoryId: string;
  isActive?: boolean;
  sortOrder?: number;
  imageUrl?: string | null;
  imagePath?: string | null;
  tenantId?: string;
};

type Addon = {
  name: string;
  price: number; // unidades
};

type MenuItem = {
  id: string;
  name: string;
  price: number; // unidades
  categoryId: string;
  subcategoryId: string;
  imageUrl?: string | null;
  imagePath?: string | null;
  addons?: Addon[];
  optionGroupIds?: string[]; // relación a option-groups
  active?: boolean;
  description?: string | null;
  tenantId?: string;
};

type OptionGroup = {
  id: string;
  name: string;
  type?: 'single' | 'multi';
  required?: boolean;
  min?: number;
  max?: number;
  active?: boolean;
  sortOrder?: number;
  tenantId?: string;
};

type OptionItem = {
  id?: string;
  groupId: string;
  name: string;
  priceDelta?: number;
  isDefault?: boolean;
  active?: boolean;
  sortOrder?: number;
  tenantId?: string;
};

/* =========================================================================
   Helpers UI / utils
   ========================================================================= */
function toNumber(v: any): number | undefined {
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}
function slugify(s: string) {
  return s
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

/* =========================================================================
   Firestore helpers (CRUD tenant-scoped)
   ========================================================================= */
async function createDocScoped(subcol: string, tenantId: string, data: any): Promise<string> {
  const { addDoc, serverTimestamp } = await getFirestoreMod();
  // tCol devuelve CollectionReference scoped: tenants/{tenantId}/{subcol}
  const ref = tCol(subcol, tenantId);
  const docRef = await addDoc(ref as any, {
    ...data,
    tenantId,
    createdAt: (serverTimestamp as any)?.(),
    updatedAt: (serverTimestamp as any)?.(),
  });
  return (docRef as any).id;
}

async function updateDocScoped(subcol: string, tenantId: string, id: string, data: any) {
  const { updateDoc, serverTimestamp } = await getFirestoreMod();
  const ref = tDoc(subcol, tenantId, id);
  await updateDoc(ref as any, { ...data, updatedAt: (serverTimestamp as any)?.() });
}

async function deleteDocScoped(subcol: string, tenantId: string, id: string) {
  const { deleteDoc } = await getFirestoreMod();
  const ref = tDoc(subcol, tenantId, id);
  await deleteDoc(ref as any);
}

/* =========================================================================
   Storage (upload / delete) — con prefijo por tenant
   ========================================================================= */
async function uploadMenuImage(tenantId: string, file: File, keyPath: string): Promise<{ url: string; path: string }> {
  const { getStorage, ref, uploadBytes, getDownloadURL } = await getStorageMod();
  const storage = getStorage();
  const finalPath = `tenants/${tenantId}/${keyPath}`;
  const r = ref(storage, finalPath);
  await uploadBytes(r, file);
  const url = await getDownloadURL(r);
  return { url, path: finalPath };
}
async function deleteImageByPath(path: string) {
  try {
    const { getStorage, ref, deleteObject } = await getStorageMod();
    const storage = getStorage();
    const r = ref(storage, path);
    await deleteObject(r);
  } catch (e) {
    console.warn('No se pudo eliminar imagen anterior:', e);
  }
}

/* =========================================================================
   Página Unificada: /admin/menu (con suscripciones en tiempo real)
   ========================================================================= */
function AdminMenuPage_Inner() {
  const tenantId = useTenantId() || '';          // ⬅️ primero el tenant
  const { authReady, user, isAdmin } = useAuthClaims(tenantId); // ⬅️ pásalo aquí

  /** ✅ Formateador global (usa currency/locale del tenant) */
  const fmtQ = useFmtQ();

  /* 🔤 idioma actual (auto) */
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
  const tt = (key: string, fb: string, vars?: Record<string, unknown>) => {
    const s = translate(lang, key, vars);
    return s === key ? fb : s;
  };

  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);
  const [groups, setGroups] = useState<OptionGroup[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [optionItems, setOptionItems] = useState<OptionItem[]>([]);

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  // Filtros para listado de platos
  const [filterCat, setFilterCat] = useState<string>('');
  const [filterSub, setFilterSub] = useState<string>('');

  // Formularios controlados
  const [catName, setCatName] = useState('');
  const [editingCatId, setEditingCatId] = useState<string | null>(null);

  // ---- estados de subcategorías ----
  const [subName, setSubName] = useState('');
  const [subCatId, setSubCatId] = useState('');
  const [editingSubId, setEditingSubId] = useState<string | null>(null);

  // ---- estados del formulario de plato ----
  const [itemEditingId, setItemEditingId] = useState<string | null>(null);
  const [itemName, setItemName] = useState('');
  const [itemPrice, setItemPrice] = useState<string>('');
  const [itemCatId, setItemCatId] = useState('');
  const [itemSubId, setItemSubId] = useState('');
  const [itemActive, setItemActive] = useState(true);
  const [itemOptionGroupIds, setItemOptionGroupIds] = useState<string[]>([]);
  const [addons, setAddons] = useState<Addon[]>([]);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [imageMeta, setImageMeta] = useState<{ url?: string | null; path?: string | null }>({});
  const [itemDescription, setItemDescription] = useState<string>('');

  // ---- UI para crear grupos inline (opcional) ----
  const [showOGCreator, setShowOGCreator] = useState(false);

  // ---- formulario de grupo (creación) ----
  const [ogName, setOgName] = useState('');
  const [ogType, setOgType] = useState<'single' | 'multi'>('single');
  const [ogRequired, setOgRequired] = useState(false);
  const [ogMin, setOgMin] = useState<number | ''>('');
  const [ogMax, setOgMax] = useState<number | ''>('');
  const [ogActive, setOgActive] = useState(true);
  const [ogSortOrder, setOgSortOrder] = useState<number | ''>('');

  // ---- option-items al crear un grupo ----
  const [oiRows, setOiRows] = useState<Array<{
    name: string;
    priceDelta: string;
    isDefault: boolean;
    active: boolean;
    sortOrder: string;
  }>>([]);

  // ---- Editor de Option-Items de grupos existentes (SECCIÓN INDEPENDIENTE) ----
  const [editGroupId, setEditGroupId] = useState<string>('');
  const optionItemsOfEditGroup = useMemo(
    () => optionItems.filter((oi) => editGroupId && oi.groupId === editGroupId),
    [optionItems, editGroupId]
  );

  const [editRows, setEditRows] = useState<Array<{
    id?: string;
    groupId: string;
    name: string;
    priceDelta?: number;
    isDefault?: boolean;
    active?: boolean;
    sortOrder?: number;
    _dirty?: boolean;
    _isNew?: boolean;
  }>>([]);

  // min/max visibles para el grupo seleccionado
  const [editGroupMin, setEditGroupMin] = useState<number | ''>('');
  const [editGroupMax, setEditGroupMax] = useState<number | ''>('');

  // Sincroniza filas editables y límites cuando cambia el grupo
  useEffect(() => {
    if (!editGroupId) {
      setEditRows([]);
      setEditGroupMin('');
      setEditGroupMax('');
      return;
    }
    const rows = optionItemsOfEditGroup
      .sort((a, b) => (Number(a.sortOrder || 0) - Number(b.sortOrder || 0)) || String(a.name||'').localeCompare(String(b.name||'')))
      .map((oi) => ({
        id: oi.id,
        groupId: oi.groupId,
        name: oi.name || '',
        priceDelta: Number(oi.priceDelta || 0),
        isDefault: !!oi.isDefault,
        active: oi.active !== false,
        sortOrder: typeof oi.sortOrder === 'number' ? oi.sortOrder : undefined,
        _dirty: false,
        _isNew: false,
      }));
    setEditRows(rows);

    const g = groups.find(x => x.id === editGroupId);
    setEditGroupMin(typeof g?.min === 'number' ? g!.min : '');
    setEditGroupMax(typeof g?.max === 'number' ? g!.max : '');
  }, [editGroupId, optionItemsOfEditGroup, groups]);

  const markRow = (idx: number, patch: Partial<typeof editRows[number]>) => {
    setEditRows((rows) => {
      const copy = [...rows];
      copy[idx] = { ...copy[idx], ...patch, _dirty: true };
      return copy;
    });
  };

  const addNewEditRow = () => {
    if (!editGroupId) { alert('Select a group'); return; }
    setEditRows((rows) => [
      ...rows,
      {
        groupId: editGroupId,
        name: '',
        priceDelta: 0,
        isDefault: false,
        active: true,
        sortOrder: undefined,
        _dirty: true,
        _isNew: true,
      }
    ]);
  };

  const saveEditRow = async (idx: number) => {
    const r = editRows[idx];
    const payload: Partial<OptionItem> = {
      groupId: r.groupId,
      name: (r.name || '').trim(),
      priceDelta: Number(r.priceDelta || 0),
      isDefault: !!r.isDefault,
      active: r.active !== false,
      sortOrder: typeof r.sortOrder === 'number' ? r.sortOrder : undefined,
    };
    if (!payload.name) { alert('Name is required'); return; }

    try {
      if (r._isNew) {
        const newId = await createDocScoped('option-items', tenantId, payload);
        setEditRows((rows) => {
          const copy = [...rows];
          copy[idx] = { ...r, id: newId, _dirty: false, _isNew: false };
          return copy;
        });
      } else {
        if (!r.id) { alert('Option ID is missing'); return; }
        await updateDocScoped('option-items', tenantId, r.id, payload);
        setEditRows((rows) => {
          const copy = [...rows];
          copy[idx] = { ...r, _dirty: false, _isNew: false };
          return copy;
        });
      }
    } catch (e: any) {
      alert(e?.message || 'Could not save the option');
    }
  };

  const deleteEditRow = async (idx: number) => {
    const r = editRows[idx];
    if (r._isNew && !r.id) {
      setEditRows((rows) => rows.filter((_, i) => i !== idx));
      return;
    }
    if (!r.id) return;
    if (!confirm('Delete this option?')) return;
    try {
      await deleteDocScoped('option-items', tenantId, r.id);
      setEditRows((rows) => rows.filter((_, i) => i !== idx));
    } catch (e: any) {
      alert(e?.message || 'Could not delete the option');
    }
  };

  const saveGroupConstraints = async () => {
    const g = groups.find(x => x.id === editGroupId);
    if (!g) return;

    let min = editGroupMin === '' ? undefined : Number(editGroupMin);
    let max = editGroupMax === '' ? undefined : Number(editGroupMax);

    if (typeof min === 'number' && min < 0) min = 0;
    if (typeof min === 'number' && typeof max === 'number' && min > max) {
      alert('min cannot be greater than max');
      return;
    }
    if (g.type === 'single') {
      if (typeof max === 'number' && max !== 1) max = 1;
      if (g.required && (min ?? 0) < 1) min = 1;
    }

    try {
      await updateDocScoped('option-groups', tenantId, g.id, { min, max });
      alert('Limits saved.');
    } catch (e: any) {
      alert(e?.message || 'Could not save min/max');
    }
  };

  /* =============================
     Suscripciones en tiempo real (tenant-scoped)
     ============================= */
  useEffect(() => {
    let unsubCats: any, unsubSubs: any, unsubGrps: any, unsubItems: any, unsubOptionItems: any;

    (async () => {
      if (!(user && isAdmin) || !tenantId) {
        setLoading(false);
        return;
      }
      try {
        setErr(null);
        setLoading(true);

        const { onSnapshot, query, orderBy } = await getFirestoreMod();

        // Categorías
        try {
          unsubCats = onSnapshot(
            query(tCol('categories', tenantId) as any, orderBy('sortOrder', 'asc')),
            (snap: any) => {
              const rows = snap.docs.map((d: any) => ({ id: d.id, ...d.data() } as any));
              setCategories(rows);
            }
          );
        } catch {
          unsubCats = onSnapshot(
            tCol('categories', tenantId) as any,
            (snap: any) => {
              const rows = snap.docs.map((d: any) => ({ id: d.id, ...d.data() } as any));
              rows.sort((a: any, b: any) => String(a?.name||'').localeCompare(String(b?.name||'')));
              setCategories(rows);
            }
          );
        }

        // Subcategorías
        try {
          unsubSubs = onSnapshot(
            query(tCol('subcategories', tenantId) as any, orderBy('sortOrder', 'asc')),
            (snap: any) => {
              const rows = snap.docs.map((d: any) => ({ id: d.id, ...d.data() } as any));
              setSubcategories(rows);
            }
          );
        } catch {
          unsubSubs = onSnapshot(
            tCol('subcategories', tenantId) as any,
            (snap: any) => {
              const rows = snap.docs.map((d: any) => ({ id: d.id, ...d.data() } as any));
              rows.sort((a: any, b: any) => String(a?.name||'').localeCompare(String(b?.name||'')));
              setSubcategories(rows);
            }
          );
        }

        // Option groups
        unsubGrps = onSnapshot(
          tCol('option-groups', tenantId) as any,
          (snap: any) => {
            const rows = snap.docs.map((d: any) => ({ id: d.id, ...d.data() } as any));
            rows.sort((a: any, b: any) => (Number(a?.sortOrder||0) - Number(b?.sortOrder||0)) || String(a?.name||'').localeCompare(String(b?.name||'')));
            setGroups(rows);
          }
        );

        // Menu items
        unsubItems = onSnapshot(
          tCol('menuItems', tenantId) as any,
          (snap: any) => {
            const rows = snap.docs.map((d: any) => ({ id: d.id, ...d.data() } as any));
            rows.sort((a: any, b: any) => String(a?.name||'').localeCompare(String(b?.name||'')));
            setItems(rows);
          }
        );

        // Option items
        unsubOptionItems = onSnapshot(
          tCol('option-items', tenantId) as any,
          (snap: any) => {
            const rows = snap.docs.map((d: any) => ({ id: d.id, ...d.data() } as any));
            setOptionItems(rows);
          }
        );

      } catch (e: any) {
        setErr(e?.message || 'Error loading data');
      } finally {
        setLoading(false);
      }
    })();

    return () => {
      try { unsubCats && unsubCats(); } catch {}
      try { unsubSubs && unsubSubs(); } catch {}
      try { unsubGrps && unsubGrps(); } catch {}
      try { unsubItems && unsubItems(); } catch {}
      try { unsubOptionItems && unsubOptionItems(); } catch {}
    };
  }, [user, isAdmin, tenantId]);

  /* =============================
     CRUD Categorías
     ============================= */
  function nextSortOrderForCategories() {
    const nums = (categories || []).map(c => Number(c.sortOrder || 0));
    const max = nums.length ? Math.max(...nums) : 0;
    return max + 1;
  }

  const onSaveCategory = async () => {
    try {
      const name = catName.trim();
      if (!name) { alert('Name is required'); return; }
      if (editingCatId) {
        const patch: Partial<Category> = {
          name,
          slug: slugify(name),
        };
        await updateDocScoped('categories', tenantId, editingCatId, patch);
      } else {
        const data: Partial<Category> = {
          name,
          slug: slugify(name),
          description: '',
          isActive: true,
          sortOrder: nextSortOrderForCategories(),
        };
        const newId = await createDocScoped('categories', tenantId, data);
        await updateDocScoped('categories', tenantId, newId, { id: newId });
      }
      setCatName('');
      setEditingCatId(null);
    } catch (e: any) {
      alert(e?.message || 'Could not save category');
    }
  };

  const onEditCategory = (c: Category) => {
    setEditingCatId(c.id);
    setCatName(c.name || '');
  };
  const onDeleteCategory = async (id: string) => {
    if (!confirm('Delete category? (You’ll also need to review related subcategories/dishes)')) return;
    try {
      await deleteDocScoped('categories', tenantId, id);
    } catch (e: any) {
      alert(e?.message || 'Could not delete');
    }
  };

  // Subir imagen categoría
  const onUploadCategoryImage = async (catId: string, file: File | null) => {
    if (!file) return;
    try {
      const current = categories.find((c) => c.id === catId);
      if (current?.imagePath) {
        try { await deleteImageByPath(current.imagePath); } catch {}
      }
      const cleanName = file.name.replace(/\s+/g, '_');
      const keyPath = `categories/${catId}/${Date.now()}_${cleanName}`;
      const up = await uploadMenuImage(tenantId, file, keyPath);
      await updateDocScoped('categories', tenantId, catId, { imageUrl: up.url, imagePath: up.path });
    } catch (e: any) {
      alert(e?.message || 'Could not upload category image');
    }
  };

  /* =============================
     CRUD Subcategorías
     ============================= */
  function nextSortOrderForSubcats(catId: string) {
    const nums = (subcategories || [])
      .filter(s => s.categoryId === catId)
      .map(s => Number(s.sortOrder || 0));
    const max = nums.length ? Math.max(...nums) : 0;
    return max + 1;
  }

  const onSaveSubcategory = async () => {
    try {
      const name = subName.trim();
      if (!name) { alert('Name is required'); return; }
      if (!subCatId) { alert('Select the category'); return; }

      if (editingSubId) {
        await updateDocScoped('subcategories', tenantId, editingSubId, {
          name,
          categoryId: subCatId,
        });
      } else {
        const data: Partial<Subcategory> = {
          name,
          categoryId: subCatId,
          isActive: true,
          sortOrder: nextSortOrderForSubcats(subCatId),
        };
        const newId = await createDocScoped('subcategories', tenantId, data);
        await updateDocScoped('subcategories', tenantId, newId, { id: newId });
      }

      setSubName('');
      setSubCatId('');
      setEditingSubId(null);
    } catch (e: any) {
      alert(e?.message || 'Could not save subcategory');
    }
  };

  const onEditSubcategory = (s: Subcategory) => {
    setEditingSubId(s.id);
    setSubName(s.name || '');
    setSubCatId(s.categoryId || '');
  };
  const onDeleteSubcategory = async (id: string) => {
    if (!confirm('Delete subcategory? (Check related dishes)')) return;
    try {
      await deleteDocScoped('subcategories', tenantId, id);
    } catch (e: any) {
      alert(e?.message || 'Could not delete');
    }
  };

  const onUploadSubcategoryImage = async (subId: string, file: File | null) => {
    if (!file) return;
    try {
      const current = subcategories.find((s) => s.id === subId);
      if (current?.imagePath) {
        try { await deleteImageByPath(current.imagePath); } catch {}
      }
      const cleanName = file.name.replace(/\s+/g, '_');
      const keyPath = `subcategories/${subId}/${Date.now()}_${cleanName}`;
      const up = await uploadMenuImage(tenantId, file, keyPath);
      await updateDocScoped('subcategories', tenantId, subId, { imageUrl: up.url, imagePath: up.path });
    } catch (e: any) {
      alert(e?.message || 'Could not upload subcategory image');
    }
  };

  /* =============================
     CRUD MenuItems (Platos)
     ============================= */
  const subcategoriesOfItemCat = useMemo(
    () => subcategories.filter((s) => !itemCatId || s.categoryId === itemCatId),
    [subcategories, itemCatId]
  );

  const itemsFiltered = useMemo(() => {
    return items.filter((mi) => {
      if (filterCat && mi.categoryId !== filterCat) return false;
      if (filterSub && mi.subcategoryId !== filterSub) return false;
      return true;
    });
  }, [items, filterCat, filterSub]);

  const onPickImage = (f: File | null) => {
    setImageFile(f);
    if (f) {
      const url = URL.createObjectURL(f);
      setImagePreview(url);
    } else {
      setImagePreview(null);
    }
  };

  const onAddAddon = () => setAddons((prev) => [...prev, { name: '', price: 0 }]);
  const onChangeAddon = (idx: number, field: 'name' | 'price', value: string) => {
    setAddons((prev) => {
      const copy = [...prev];
      if (field === 'name') copy[idx].name = value;
      if (field === 'price') copy[idx].price = Number(value) || 0;
      return copy;
    });
  };
  const onRemoveAddon = (idx: number) => {
    setAddons((prev) => prev.filter((_, i) => i !== idx));
  };

  const onEditItem = (mi: MenuItem) => {
    setItemEditingId(mi.id);
    setItemName(mi.name || '');
    setItemPrice(String(mi.price ?? ''));
    setItemCatId(mi.categoryId || '');
    setItemSubId(mi.subcategoryId || '');
    setItemActive(mi.active !== false);
    setItemOptionGroupIds(Array.isArray(mi.optionGroupIds) ? mi.optionGroupIds : []);
    setAddons(Array.isArray(mi.addons) ? mi.addons.map(a => ({ name: a.name, price: Number(a.price || 0) })) : []);
    setImageMeta({ url: mi.imageUrl || null, path: mi.imagePath || null });
    setImageFile(null);
    setImagePreview(null);
    setItemDescription((mi as any).description || '');
  };

  const onDeleteItem = async (id: string, imgPath?: string | null) => {
    if (!confirm('Delete dish?')) return;
    try {
      await deleteDocScoped('menuItems', tenantId, id);
      if (imgPath) await deleteImageByPath(imgPath);
      if (itemEditingId === id) {
        setItemEditingId(null);
        setItemName('');
        setItemPrice('');
        setItemCatId('');
        setItemSubId('');
        setItemActive(true);
        setItemOptionGroupIds([]);
        setAddons([]);
        setImageFile(null);
        setImagePreview(null);
        setImageMeta({});
        setItemDescription('');
      }
    } catch (e: any) {
      alert(e?.message || 'Could not delete dish');
    }
  };

  const onSaveItem = async () => {
    try {
      const priceN = toNumber(itemPrice);
      if (!itemName.trim()) { alert('Name is required'); return; }
      if (!priceN || priceN <= 0) { alert('Invalid price'); return; }
      if (!itemCatId) { alert('Select category'); return; }
      if (!itemSubId) { alert('Select subcategory'); return; }

      const payloadBase = {
        name: itemName.trim(),
        price: priceN,
        categoryId: itemCatId,
        subcategoryId: itemSubId,
        optionGroupIds: itemOptionGroupIds,
        addons: addons.map(a => ({ name: a.name.trim(), price: Number(a.price || 0) })).filter(a => a.name),
        active: !!itemActive,
        description: itemDescription.trim() ? itemDescription.trim() : null,
      } as Partial<MenuItem>;

      let id = itemEditingId || '';
      if (!itemEditingId) {
        id = await createDocScoped('menuItems', tenantId, payloadBase);
      } else {
        await updateDocScoped('menuItems', tenantId, itemEditingId, payloadBase);
      }

      if (imageFile) {
        if (imageMeta?.path) {
          try { await deleteImageByPath(imageMeta.path); } catch {}
        }
        const cleanName = imageFile.name.replace(/\s+/g, '_');
        const keyPath = `menu/${id}/${Date.now()}_${cleanName}`;
        const up = await uploadMenuImage(tenantId, imageFile, keyPath);
        await updateDocScoped('menuItems', tenantId, id, { imageUrl: up.url, imagePath: up.path });
      }

      // reset
      setItemEditingId(null);
      setItemName('');
      setItemPrice('');
      setItemCatId('');
      setItemSubId('');
      setItemActive(true);
      setItemOptionGroupIds([]);
      setAddons([]);
      setImageFile(null);
      setImagePreview(null);
      setImageMeta({});
      setItemDescription('');

      alert('Dish saved.');
    } catch (e: any) {
      alert(e?.message || 'Could not save dish');
    }
  };

  /* =============================
     UI helpers
     ============================= */
  const scrollToGroups = () => {
    const el = document.getElementById('option-groups-editor');
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  /* =========================================================================
     Render
     ========================================================================= */
  if (!authReady) return <div className="container py-3">{tt('admin.menu.init', 'Initializing session…')}</div>;
  if (!user) return <div className="container py-5 text-danger">{tt('admin.menu.notLogged', 'You must sign in.')}</div>;
  if (!isAdmin) return <div className="container py-5 text-danger">{tt('admin.menu.unauthorized', 'Unauthorized (admins only).')}</div>;

  return (
    <div className="container py-3">
      <div className="d-flex align-items-center justify-content-between mb-3">
        <h1 className="h4 m-0">{tt('admin.menu.title', 'Menu — Categories, Subcategories & Dishes')}</h1>
        <span className="text-muted small">{tt('admin.menu.realtime', 'Real-time updates')}</span>
      </div>
      {err && <div className="alert alert-danger">{err}</div>}

      <div className="row g-3">
        {/* ===================== Columna 1: Categorías ===================== */}
        <div className="col-12 col-lg-3">
          <div className="card">
            <div className="card-header">{tt('admin.menu.categories.title', 'Categories')}</div>
            <div className="card-body">
              <div className="mb-2">
                <label className="form-label">{tt('admin.menu.field.name', 'Name')}</label>
                <input className="form-control" value={catName} onChange={(e) => setCatName(e.target.value)} />
              </div>
              <div className="d-flex gap-2">
                <button className="btn btn-primary btn-sm" onClick={onSaveCategory}>
                  {editingCatId ? tt('admin.menu.btn.saveChanges', 'Save changes') : tt('admin.menu.btn.create', 'Create')}
                </button>
                {editingCatId && (
                  <button className="btn btn-outline-secondary btn-sm" onClick={() => { setEditingCatId(null); setCatName(''); }}>
                    {tt('admin.menu.btn.cancel', 'Cancel')}
                  </button>
                )}
              </div>
              <hr />
              <div className="list-group">
                {categories.map((c) => (
                  <div key={c.id} className="list-group-item d-flex justify-content-between align-items-start gap-3 flex-wrap">
                    <div className="d-flex align-items-center gap-2 flex-grow-1 me-2" style={{ minWidth: 0 }}>
                      <div style={{ width: 48, height: 48, background: '#f8f9fa', borderRadius: 6, overflow: 'hidden', flex: '0 0 auto' }}>
                        {c.imageUrl ? (
                          <img src={c.imageUrl} alt={c.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                        ) : (
                          <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted" style={{ fontSize: 10 }}>
                            {tt('admin.menu.noImageShort', 'No img')}
                          </div>
                        )}
                      </div>
                      <div className="text-truncate">
                        <div className="fw-semibold text-truncate">{c.name}</div>
                        <div className="text-muted small text-truncate">
                          slug: {c.slug || '—'} · {tt('admin.menu.field.order', 'order')}: {c.sortOrder ?? '—'} · {tt('admin.menu.field.active', 'active')}: {String(c.isActive ?? true)}
                        </div>
                      </div>
                    </div>
                    {/* Botones en columna */}
                    <div className="d-flex flex-column gap-2 align-items-stretch" style={{ minWidth: 140 }}>
                      <label className="btn btn-outline-primary btn-sm w-100 m-0">
                        {tt('admin.menu.btn.image', 'Image')}
                        <input
                          type="file"
                          accept="image/*"
                          className="d-none"
                          onChange={(e) => {
                            const f = e.target.files?.[0] || null;
                            onUploadCategoryImage(c.id, f);
                            e.currentTarget.value = "";
                          }}
                        />
                      </label>
                      <button className="btn btn-outline-secondary btn-sm w-100" onClick={() => onEditCategory(c)}>
                        {tt('admin.menu.btn.edit', 'Edit')}
                      </button>
                      <button className="btn btn-outline-danger btn-sm w-100" onClick={() => onDeleteCategory(c.id)}>
                        {tt('admin.menu.btn.delete', 'Delete')}
                      </button>
                    </div>
                  </div>
                ))}
                {categories.length === 0 && <div className="text-muted small">{tt('admin.menu.empty.categories', 'No categories.')}</div>}
              </div>
            </div>
          </div>
        </div>

        {/* ===================== Columna 2: Subcategorías ===================== */}
        <div className="col-12 col-lg-3">
          <div className="card">
            <div className="card-header">{tt('admin.menu.subcategories.title', 'Subcategories')}</div>
            <div className="card-body">
              <div className="mb-2">
                <label className="form-label">{tt('admin.menu.field.category', 'Category')}</label>
                <select className="form-select" value={subCatId} onChange={(e) => setSubCatId(e.target.value)}>
                  <option value="">{tt('admin.menu.ph.selectCategory', 'Select category…')}</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div className="mb-2">
                <label className="form-label">{tt('admin.menu.field.name', 'Name')}</label>
                <input className="form-control" value={subName} onChange={(e) => setSubName(e.target.value)} />
              </div>
              <div className="d-flex gap-2">
                <button className="btn btn-primary btn-sm" onClick={onSaveSubcategory}>
                  {editingSubId ? tt('admin.menu.btn.saveChanges', 'Save changes') : tt('admin.menu.btn.create', 'Create')}
                </button>
                {editingSubId && (
                  <button className="btn btn-outline-secondary btn-sm" onClick={() => { setEditingSubId(null); setSubName(''); setSubCatId(''); }}>
                    {tt('admin.menu.btn.cancel', 'Cancel')}
                  </button>
                )}
              </div>
              <hr />
              <div className="list-group">
                {subcategories.map((s) => {
                  const catName = categories.find((c) => c.id === s.categoryId)?.name || '—';
                  return (
                    <div key={s.id} className="list-group-item d-flex justify-content-between align-items-start gap-3 flex-wrap">
                      <div className="d-flex align-items-center gap-2 flex-grow-1 me-2" style={{ minWidth: 0 }}>
                        <div style={{ width: 44, height: 44, background: '#f8f9fa', borderRadius: 6, overflow: 'hidden' }}>
                          {s.imageUrl ? (
                            <img src={s.imageUrl} alt={s.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          ) : (
                            <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted" style={{ fontSize: 10 }}>
                              {tt('admin.menu.noImageShort', 'No img')}
                            </div>
                          )}
                        </div>
                        <div className="text-truncate">
                          <div className="fw-semibold text-truncate">{s.name}</div>
                          <div className="text-muted small text-truncate">
                            {tt('admin.menu.field.category', 'Category')}: {catName} · {tt('admin.menu.field.order', 'order')}: {s.sortOrder ?? '—'}
                          </div>
                        </div>
                      </div>
                      {/* Botones en columna */}
                      <div className="d-flex flex-column gap-2 align-items-stretch" style={{ minWidth: 140 }}>
                        <label className="btn btn-outline-primary btn-sm w-100 m-0">
                          {tt('admin.menu.btn.image', 'Image')}
                          <input
                            type="file"
                            accept="image/*"
                            className="d-none"
                            onChange={(e) => {
                              const f = e.target.files?.[0] || null;
                              onUploadSubcategoryImage(s.id, f);
                              e.currentTarget.value = "";
                            }}
                          />
                        </label>
                        <button className="btn btn-outline-secondary btn-sm w-100" onClick={() => onEditSubcategory(s)}>
                          {tt('admin.menu.btn.edit', 'Edit')}
                        </button>
                        <button className="btn btn-outline-danger btn-sm w-100" onClick={() => onDeleteSubcategory(s.id)}>
                          {tt('admin.menu.btn.delete', 'Delete')}
                        </button>
                      </div>
                    </div>
                  );
                })}
                {subcategories.length === 0 && <div className="text-muted small">{tt('admin.menu.empty.subcategories', 'No subcategories.')}</div>}
              </div>
            </div>
          </div>
        </div>

        {/* ===================== Columna 3: Crear / Editar Plato ===================== */}
        <div className="col-12 col-lg-6">
          <div className="card">
            <div className="card-header d-flex align-items-center justify-content-between">
              <span>{itemEditingId ? tt('admin.menu.item.edit', 'Edit dish') : tt('admin.menu.item.create', 'Create dish')}</span>
              <button type="button" className="btn btn-sm btn-outline-secondary" onClick={scrollToGroups}>
                {tt('admin.menu.groups.edit', 'Edit groups')}
              </button>
            </div>
            <div className="card-body">
              <div className="row g-3">
                <div className="col-12 col-md-6">
                  <label className="form-label">{tt('admin.menu.field.category', 'Category')}</label>
                  <select className="form-select" value={itemCatId} onChange={(e) => { setItemCatId(e.target.value); setItemSubId(''); }}>
                    <option value="">{tt('admin.menu.ph.selectCategory', 'Select category…')}</option>
                    {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
                <div className="col-12 col-md-6">
                  <label className="form-label">{tt('admin.menu.field.subcategory', 'Subcategory')}</label>
                  <select className="form-select" value={itemSubId} onChange={(e) => setItemSubId(e.target.value)} disabled={!itemCatId}>
                    <option value="">
                      {itemCatId ? tt('admin.menu.ph.selectSubcategory', 'Select subcategory…') : tt('admin.menu.ph.selectCategoryFirst', 'Select a category first')}
                    </option>
                    {subcategories.filter((s) => !itemCatId || s.categoryId === itemCatId).map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                  </select>
                </div>

                <div className="col-12 col-md-6">
                  <label className="form-label">{tt('admin.menu.field.dishName', 'Dish name')}</label>
                  <input className="form-control" value={itemName} onChange={(e) => setItemName(e.target.value)} />
                </div>
                <div className="col-12 col-md-3">
                  <label className="form-label">{tt('admin.menu.field.price', 'Price')}</label>
                  <input
                    type="number"
                    step="0.01"
                    className="form-control"
                    value={itemPrice}
                    onChange={(e) => setItemPrice(e.target.value)}
                  />
                </div>
                <div className="col-12 col-md-3 d-flex align-items-end">
                  <div className="form-check">
                    <input className="form-check-input" type="checkbox" id="activeCheck" checked={itemActive} onChange={(e) => setItemActive(e.target.checked)} />
                    <label className="form-check-label" htmlFor="activeCheck">{tt('admin.menu.field.activeCk', 'Active')}</label>
                  </div>
                </div>

                <div className="col-12">
                  <label className="form-label">{tt('admin.menu.groups.label', 'Option groups')}</label>
                  <div className="d-flex align-items-center justify-content-between mb-2">
                    <small className="text-muted">{tt('admin.menu.groups.hint', 'Check the groups that apply to this dish.')}</small>
                    <button
                      type="button"
                      className="btn btn-sm btn-outline-primary"
                      onClick={() => setShowOGCreator(s => !s)}
                    >
                      {showOGCreator ? tt('admin.menu.btn.hide', 'Hide') : tt('admin.menu.btn.createGroup', 'Create new group & options')}
                    </button>
                  </div>
                  <div className="border rounded p-2" style={{ maxHeight: 160, overflow: 'auto' }}>
                    {groups.length === 0 && <div className="text-muted small">{tt('admin.menu.groups.empty', 'No option groups.')}</div>}
                    {groups.map((g) => {
                      const checked = itemOptionGroupIds.includes(g.id);
                      return (
                        <div key={g.id} className="form-check">
                          <input
                            className="form-check-input"
                            type="checkbox"
                            id={`g_${g.id}`}
                            checked={checked}
                            onChange={(e) => {
                              const v = e.currentTarget.checked;
                              setItemOptionGroupIds((prev) => v ? [...new Set([...prev, g.id])] : prev.filter((x) => x !== g.id));
                            }}
                          />
                          <label className="form-check-label" htmlFor={`g_${g.id}`}>
                            {g.name}
                            {g.required ? <span className="badge text-bg-light ms-1">{tt('admin.menu.badge.required', 'required')}</span> : null}
                            {g.type ? <span className="badge text-bg-secondary ms-1">{g.type}</span> : null}
                          </label>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Descripción del plato */}
                <div className="col-12">
                  <label className="form-label">{tt('admin.menu.field.description', 'Description (visible only in the Menu)')}</label>
                  <textarea
                    className="form-control"
                    rows={3}
                    placeholder={tt('admin.menu.ph.description', 'Briefly describe the dish (optional)')}
                    value={itemDescription}
                    onChange={(e) => setItemDescription(e.target.value)}
                  />
                </div>

                {/* Addons */}
                <div className="col-12">
                  <label className="form-label d-flex align-items-center justify-content-between">
                    <span>{tt('admin.menu.addons.title', 'Add-ons (paid extras)')}</span>
                    <button type="button" className="btn btn-outline-primary btn-sm" onClick={onAddAddon}>
                      {tt('admin.menu.addons.add', '+ Add add-on')}
                    </button>
                  </label>
                  {addons.length === 0 && <div className="text-muted small">{tt('admin.menu.addons.empty', 'No add-ons.')}</div>}
                  {addons.map((a, idx) => (
                    <div key={idx} className="row g-2 align-items-center mb-1">
                      <div className="col-7">
                        <input className="form-control" placeholder={tt('admin.menu.field.name', 'Name')} value={a.name} onChange={(e) => onChangeAddon(idx, 'name', e.target.value)} />
                      </div>
                      <div className="col-3">
                        <input
                          type="number"
                          step="0.01"
                          className="form-control"
                          placeholder={tt('admin.menu.field.price', 'Price')}
                          value={a.price}
                          onChange={(e) => onChangeAddon(idx, 'price', e.target.value)}
                        />
                      </div>
                      <div className="col-2 text-end">
                        <button type="button" className="btn btn-outline-danger btn-sm" onClick={() => onRemoveAddon(idx)}>
                          {tt('admin.menu.btn.delete', 'Delete')}
                        </button>
                      </div>
                    </div>
                  ))}
                </div>

                {/* Imagen */}
                <div className="col-12 col-md-8">
                  <ImagePicker
                    imagePreview={imagePreview}
                    imageMetaUrl={(imageMeta as any)?.url || null}
                    onPick={onPickImage}
                  />
                </div>
                <div className="col-12 col-md-4 d-flex align-items-end">
                  <div className="d-flex gap-2">
                    <button className="btn btn-primary" onClick={onSaveItem}>
                      {itemEditingId ? tt('admin.menu.btn.saveChanges', 'Save changes') : tt('admin.menu.item.create', 'Create dish')}
                    </button>
                    {itemEditingId && (
                      <button className="btn btn-outline-secondary" onClick={() => {
                        setItemEditingId(null);
                        setItemName('');
                        setItemPrice('');
                        setItemCatId('');
                        setItemSubId('');
                        setItemActive(true);
                        setItemOptionGroupIds([]);
                        setAddons([]);
                        setImageFile(null);
                        setImagePreview(null);
                        setImageMeta({});
                        setItemDescription('');
                      }}>{tt('admin.menu.btn.cancel', 'Cancel')}</button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* ===================== Sección independiente: Option-Groups ===================== */}
          <div id="option-groups-editor" className="card mt-3">
            <div className="card-header d-flex align-items-center justify-content-between">
              <span>{tt('admin.menu.groups.editor.title', 'Option Groups — edit items and limits')}</span>
              <div className="d-flex align-items-center gap-2">
                <label className="form-label m-0 small">{tt('admin.menu.groups.editor.select', 'Select group:')}</label>
                <select
                  className="form-select form-select-sm"
                  style={{ minWidth: 260 }}
                  value={editGroupId}
                  onChange={(e) => setEditGroupId(e.target.value)}
                >
                  <option value="">{tt('admin.menu.groups.editor.choose', '— Choose —')}</option>
                  {groups.map((g) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <div className="card-body">
              {!editGroupId && (
                <div className="text-muted small">{tt('admin.menu.groups.editor.empty', 'Select a group to view and edit its options.')}</div>
              )}

              {!!editGroupId && (
                <>
                  {/* Controles de min / max del grupo */}
                  <div className="row g-2 align-items-end mb-3">
                    <div className="col-6 col-md-2">
                      <label className="form-label">{tt('admin.menu.groups.editor.min', 'Min')}</label>
                      <input
                        type="number"
                        className="form-control form-control-sm"
                        value={editGroupMin}
                        onChange={(e) => {
                          const v = e.target.value;
                          setEditGroupMin(v === '' ? '' : Number(v));
                        }}
                      />
                    </div>
                    <div className="col-6 col-md-2">
                      <label className="form-label">{tt('admin.menu.groups.editor.max', 'Max')}</label>
                      <input
                        type="number"
                        className="form-control form-control-sm"
                        value={editGroupMax}
                        onChange={(e) => {
                          const v = e.target.value;
                          setEditGroupMax(v === '' ? '' : Number(v));
                        }}
                      />
                    </div>
                    <div className="col-12 col-md-3">
                      <button type="button" className="btn btn-sm btn-primary w-100" onClick={saveGroupConstraints}>
                        {tt('admin.menu.groups.editor.saveLimits', 'Save limits')}
                      </button>
                    </div>
                  </div>

                  {/* Editor de Option-Items del grupo seleccionado */}
                  <div className="d-flex align-items-center justify-content-between mb-2">
                    <small className="text-muted">{tt('admin.menu.groups.editor.hint', 'Add, edit or delete options. Changes are saved per row.')}</small>
                    <button className="btn btn-sm btn-outline-primary" onClick={addNewEditRow}>
                      {tt('admin.menu.groups.editor.addOption', '+ Add option')}
                    </button>
                  </div>

                  {editRows.length === 0 && <div className="text-muted small">{tt('admin.menu.groups.editor.noOptions', 'This group has no options.')}</div>}

                  {editRows.map((r, idx) => (
                    <div key={r.id || `new_${idx}`} className="row g-2 align-items-end mb-2">
                      <div className="col-12 col-md-4">
                        <label className="form-label">{tt('admin.menu.field.name', 'Name')}</label>
                        <input
                          className="form-control form-control-sm"
                          value={r.name}
                          onChange={(e) => markRow(idx, { name: e.target.value })}
                        />
                      </div>
                      <div className="col-6 col-md-2">
                        <label className="form-label">{tt('admin.menu.field.deltaPrice', 'Δ Price')}</label>
                        <input
                          type="number"
                          step="0.01"
                          className="form-control form-control-sm"
                          value={r.priceDelta ?? 0}
                          onChange={(e) => markRow(idx, { priceDelta: Number(e.target.value || 0) })}
                        />
                      </div>
                      <div className="col-6 col-md-2">
                        <label className="form-label">{tt('admin.menu.field.order', 'Order')}</label>
                        <input
                          type="number"
                          className="form-control form-control-sm"
                          value={typeof r.sortOrder === 'number' ? r.sortOrder : ''}
                          onChange={(e) => {
                            const val = e.target.value === '' ? undefined : Number(e.target.value);
                            markRow(idx, { sortOrder: val });
                          }}
                        />
                      </div>
                      <div className="col-6 col-md-2">
                        <div className="form-check">
                          <input
                            className="form-check-input"
                            type="checkbox"
                            id={`edDef_${r.id || idx}`}
                            checked={!!r.isDefault}
                            onChange={(e) => markRow(idx, { isDefault: e.target.checked })}
                          />
                          <label className="form-check-label" htmlFor={`edDef_${r.id || idx}`}>{tt('admin.menu.field.default', 'Default')}</label>
                        </div>
                      </div>
                      <div className="col-6 col-md-2">
                        <div className="form-check">
                          <input
                            className="form-check-input"
                            type="checkbox"
                            id={`edAct_${r.id || idx}`}
                            checked={r.active !== false}
                            onChange={(e) => markRow(idx, { active: e.target.checked })}
                          />
                          <label className="form-check-label" htmlFor={`edAct_${r.id || idx}`}>{tt('admin.menu.field.activeCk', 'Active')}</label>
                        </div>
                      </div>

                      <div className="col-12 d-flex justify-content-end gap-2">
                        <button className="btn btn-outline-danger btn-sm" onClick={() => deleteEditRow(idx)}>
                          {tt('admin.menu.btn.delete', 'Delete')}
                        </button>
                        <button className="btn btn-primary btn-sm" disabled={!r._dirty} onClick={() => saveEditRow(idx)}>
                          {tt('admin.menu.btn.save', 'Save')}
                        </button>
                      </div>
                    </div>
                  ))}
                </>
              )}
            </div>
          </div>

          {/* ===================== Listado de Platos ===================== */}
          <div className="card mt-3">
            <div className="card-header">
              {tt('admin.menu.dishes.title', 'Dishes')}
              <div className="float-end">
                <select className="form-select form-select-sm d-inline-block me-2" style={{ width: 200 }} value={filterCat} onChange={(e) => { setFilterCat(e.target.value); setFilterSub(''); }}>
                  <option value="">{tt('admin.menu.filter.allCats', '(All categories)')}</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <select className="form-select form-select-sm d-inline-block" style={{ width: 200 }} value={filterSub} onChange={(e) => setFilterSub(e.target.value)}>
                  <option value="">{tt('admin.menu.filter.allSubs', '(All Subcategories)')}</option>
                  {subcategories
                    .filter((s) => !filterCat || s.categoryId === filterCat)
                    .map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
            </div>
            <div className="card-body">
              {itemsFiltered.length === 0 && <div className="text-muted small">{tt('admin.menu.empty.results', 'No results.')}</div>}
              <div className="row g-3">
                {itemsFiltered.map((mi) => {
                  const cName = categories.find((c) => c.id === mi.categoryId)?.name || '—';
                  const sName = subcategories.find((s) => s.id === mi.subcategoryId)?.name || '—';
                  const gNames = (mi.optionGroupIds || []).map((gid) => groups.find((g) => g.id === gid)?.name).filter(Boolean) as string[];
                  return (
                    <div key={mi.id} className="col-12 col-md-6">
                      <div className="card h-100">
                        <div className="card-body">
                          <div className="d-flex gap-3">
                            <div style={{ width: 96, height: 96, background: '#f8f9fa', borderRadius: 8, overflow: 'hidden' }}>
                              {mi.imageUrl ? (
                                <img src={mi.imageUrl} alt={mi.name} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                              ) : (
                                <div className="d-flex h-100 w-100 align-items-center justify-content-center text-muted small">
                                  {tt('admin.menu.noImage', 'No image')}
                                </div>
                              )}
                            </div>
                            <div className="flex-fill">
                              <div className="d-flex justify-content-between">
                                <div className="fw-semibold">{mi.name}</div>
                                <div className="fw-semibold">{fmtQ(mi.price)}</div>
                              </div>
                              <div className="text-muted small">
                                {cName} · {sName} {mi.active === false ? <span className="badge text-bg-warning ms-1">{tt('admin.menu.badge.inactive', 'Inactive')}</span> : null}
                              </div>
                              {!!gNames.length && (
                                <div className="text-muted small mt-1">{tt('admin.menu.groups.short', 'Groups')}: {gNames.join(', ')}</div>
                              )}
                              {!!mi.addons?.length && (
                                <div className="text-muted small mt-1">
                                  {tt('admin.menu.addons.short', 'Addons')}: {mi.addons.map(a => `${a.name} (${fmtQ(a.price)})`).join(', ')}
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                        <div className="card-footer d-flex justify-content-end gap-2">
                          <button className="btn btn-outline-secondary btn-sm" onClick={() => onEditItem(mi)}>
                            {tt('admin.menu.btn.edit', 'Edit')}
                          </button>
                          <button className="btn btn-outline-danger btn-sm" onClick={() => onDeleteItem(mi.id, mi.imagePath)}>
                            {tt('admin.menu.btn.delete', 'Delete')}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

        </div>
      </div>
    </div>
  );
}

/* Pequeño componente para la imagen */
function ImagePicker({
  imagePreview,
  imageMetaUrl,
  onPick,
}: {
  imagePreview: string | null;
  imageMetaUrl: string | null;
  onPick: (f: File | null) => void;
}) {
  /* 🔤 no cambiar lógica; solo etiquetas visibles */
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
  const tt = (key: string, fb: string, vars?: Record<string, unknown>) => {
    const s = translate(lang, key, vars);
    return s === key ? fb : s;
  };

  return (
    <>
      <label className="form-label">{tt('admin.menu.image.label', 'Image (Storage)')}</label>
      <input
        type="file"
        accept="image/*"
        className="form-control"
        onChange={(e) => onPick(e.target.files?.[0] || null)}
      />
      {!!imagePreview && (
        <div className="mt-2">
          <img src={imagePreview} alt="preview" style={{ maxWidth: '100%', maxHeight: 180, objectFit: 'contain' }} />
        </div>
      )}
      {!imagePreview && imageMetaUrl && (
        <div className="mt-2">
          <img src={imageMetaUrl} alt="current" style={{ maxWidth: '100%', maxHeight: 180, objectFit: 'contain' }} />
        </div>
      )}
      {imageMetaUrl && (
        <div className="text-muted small mt-1">
          {tt('admin.menu.image.current', 'Current image')}: <a href={imageMetaUrl} target="_blank" rel="noopener noreferrer">{tt('admin.menu.image.view', 'view')}</a>
        </div>
      )}
    </>
  );
}

export default function AdminMenuPage() {
  return (
    <Protected>
      <AdminOnly>
        <ToolGate feature="menu">
          <AdminMenuPage_Inner />
        </ToolGate>
      </AdminOnly>
    </Protected>
  );
}
