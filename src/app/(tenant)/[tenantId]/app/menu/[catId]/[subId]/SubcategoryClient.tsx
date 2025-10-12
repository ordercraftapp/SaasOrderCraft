// src/app/(tenant)/[tenantId]/app/menu/[catId]/[subId]/SubcategoryClient.tsx
"use client";

import { useEffect, useMemo, useState } from "react";
import {
  getFirestore,
  query,
  where,
  onSnapshot,
  getDoc,
  doc,
  getDocs,
  limit,
} from "firebase/firestore";
import Image from "next/image";
import Link from "next/link";
import { useNewCart } from "@/lib/newcart/context"; // carrito NUEVO
import { useFmtQ } from "@/lib/settings/money"; // CurrencyUpdate: usar el formateador global basado en SettingsProvider

/* 🔤 i18n */
import { t as translate } from "@/lib/i18n/t";
import { useTenantSettings } from "@/lib/settings/hooks";

/* ✅ Tenant (cliente) + helpers Firestore namespaced */
import { useTenantId } from "@/lib/tenant/context";
import { tCol } from "@/lib/db";

type Category = { id: string; name: string; slug?: string };
type Subcategory = { id: string; name: string; slug?: string; categoryId: string };

type Addon = { name: string; price: number };

type MenuItem = {
  id: string;
  name: string;
  price: number;
  imageUrl?: string | null;
  isAvailable?: boolean;
  active?: boolean;
  description?: string | null;
  addons?: Addon[];
  optionGroupIds?: string[];
};

type OptionGroup = {
  id: string;
  name: string;
  type?: "single" | "multi";
  required?: boolean;
  min?: number;
  max?: number;
  active?: boolean;
};

type OptionItem = {
  id: string;
  groupId: string;
  name: string;
  priceDelta?: number;
  isDefault?: boolean;
  active?: boolean;
};

// CurrencyUpdate: eliminada la función local fmtQ con valores fijos de "USD"/"es-GT"

/* =========================
   NUEVO: helpers de centavos
   ========================= */
function toCents(x: any): number {
  const n = Number(x);
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

/* --------------------------------------------
   🔤 Helper i18n
--------------------------------------------- */
function useLangTT() {
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
  return { lang, tt } as const;
}

export default function SubcategoryClient({ catId, subId }: { catId: string; subId: string }) {
  const db = useMemo(() => getFirestore(), []);
  const tenantId = useTenantId();

  // Prefija rutas con /{tenantId}
  const withTenant = (p: string) => {
    if (!tenantId) return p;
    const norm = p.startsWith("/") ? p : `/${p}`;
    if (norm.startsWith(`/${tenantId}/`)) return norm;
    return `/${tenantId}${norm}`;
  };

  const [category, setCategory] = useState<Category | null>(null);
  const [subcategory, setSubcategory] = useState<Subcategory | null>(null);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [addingId, setAddingId] = useState<string | null>(null);

  const { tt } = useLangTT();

  // 👇 Mensaje pequeño “Agregado”
  const [flash, setFlash] = useState<{ id: string; name: string } | null>(null);

  // carrito NUEVO
  const newCart = (() => {
    try { return useNewCart(); } catch { return null as any; }
  })();

  // CurrencyUpdate: formateador conectado a SettingsProvider (currency/locale por tenant)
  const fmtQ = useFmtQ();

  // Estados por tarjeta
  const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
  const [selectedAddons, setSelectedAddons] = useState<Record<string, Record<string, boolean>>>({});
  // - 'single': guarda string con id seleccionado
  // - 'multi' : guarda Record<optionId:boolean>
  const [selectedOptions, setSelectedOptions] =
    useState<Record<string, Record<string, string | Record<string, boolean>>>>({});

  // Cache de groups e items
  const [itemGroups, setItemGroups] = useState<Record<string, OptionGroup[]>>({});
  const [groupItems, setGroupItems] = useState<Record<string, OptionItem[]>>({}); // key: groupId -> items

  // Carga categoría/subcat y items (✅ ahora bajo tenants/{tenantId}/...)
  useEffect(() => {
    if (!tenantId) return;
    const unsubList: Array<() => void> = [];
    (async () => {
      // categoría
      const catRef = doc(tCol("categories", tenantId), catId);
      const catSnap = await getDoc(catRef);
      if (catSnap.exists()) setCategory({ id: catSnap.id, ...(catSnap.data() as any) });

      // Resolver sub por id o por slug
      let realSubId = subId;
      let subData: any | null = null;

      const subRefById = doc(tCol("subcategories", tenantId), subId);
      const byId = await getDoc(subRefById);

      if (byId.exists()) {
        subData = byId.data();
      } else {
        const bySlug = await getDocs(
          query(tCol("subcategories", tenantId), where("slug", "==", subId), limit(1))
        );
        if (!bySlug.empty) {
          const d = bySlug.docs[0];
          realSubId = d.id;
          subData = d.data();
        }
      }
      if (subData) setSubcategory({ id: realSubId, ...(subData as any) });

      // Items de la subcategoría
      const qItems = query(tCol("menuItems", tenantId), where("subcategoryId", "==", realSubId));
      const unsub = onSnapshot(qItems, (s) => {
        const rows: MenuItem[] = s.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
        rows.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
        setItems(rows);
      });
      unsubList.push(unsub);
    })();

    return () => unsubList.forEach((fn) => { try { fn(); } catch {} });
  }, [db, catId, subId, tenantId]);

  function isDisabled(mi: MenuItem) {
    if (mi.active === false) return true;
    if (mi.isAvailable === false) return true;
    return false;
  }

  async function onToggleOptions(mi: MenuItem) {
    const nowExpanded = expandedItemId === mi.id ? null : mi.id;
    setExpandedItemId(nowExpanded);

    if (!nowExpanded || !tenantId) return; // cerrando o sin tenant aún

    // Cargar groups del item si no están ya
    const ogIds = Array.isArray(mi.optionGroupIds) ? mi.optionGroupIds : [];
    if (ogIds.length) {
      // obtener grupos que falten
      const missing = ogIds.filter(
        (gid) => !(itemGroups[mi.id]?.some((g) => g.id === gid))
      );
      if (missing.length) {
        const fetched: OptionGroup[] = [];
        for (const gid of missing) {
          const gRef = doc(tCol("option-groups", tenantId), gid);
          const snap = await getDoc(gRef);
          if (snap.exists()) {
            fetched.push({ id: snap.id, ...(snap.data() as any) });
          }
        }
        if (fetched.length) {
          setItemGroups((prev) => ({
            ...prev,
            [mi.id]: [...(prev[mi.id] || []), ...fetched].filter(Boolean),
          }));
        }
      }

      // por cada groupId, cargar sus option-items (si faltan)
      const groupsToEnsure = itemGroups[mi.id] || [];
      const ensureIds = new Set<string>([...ogIds, ...groupsToEnsure.map((g) => g.id)]);
      for (const gid of ensureIds) {
        if (!groupItems[gid]) {
          const qIt = query(tCol("option-items", tenantId), where("groupId", "==", gid));
          const snaps = await getDocs(qIt);
          const its: OptionItem[] = snaps.docs.map((d) => ({ id: d.id, ...(d.data() as any) }));
          its.sort((a, b) => String(a.name || "").localeCompare(String(b.name || "")));
          setGroupItems((prev) => ({ ...prev, [gid]: its }));
        }
      }
    }

    // Inicializar selecciones por defecto si no existe estado previo
    setSelectedAddons((prev) => prev[mi.id] ? prev : { ...prev, [mi.id]: {} });

    setSelectedOptions((prev) => {
      if (prev[mi.id]) return prev; // ya inicializado
      const nextForItem: Record<string, string | Record<string, boolean>> = {};
      const groups = itemGroups[mi.id] || [];
      for (const g of groups) {
        const items = groupItems[g.id] || [];
        if (g.type === "single") {
          // buscar default
          const def = items.find((oi) => oi.isDefault && oi.active !== false);
          if (def) nextForItem[g.id] = def.id;
          else if (g.required && items.length) nextForItem[g.id] = items[0].id; // fallback
          else nextForItem[g.id] = "";
        } else {
          // multi: iniciar con los que tengan isDefault
          const bag: Record<string, boolean> = {};
          items.forEach((oi) => {
            if (oi.isDefault && oi.active !== false) bag[oi.id] = true;
          });
          nextForItem[g.id] = bag;
        }
      }
      return { ...prev, [mi.id]: nextForItem };
    });
  }

  function toggleAddon(mi: MenuItem, addonName: string) {
    setSelectedAddons((prev) => {
      const current = prev[mi.id] || {};
      const next = { ...current, [addonName]: !current[addonName] };
      return { ...prev, [mi.id]: next };
    });
  }

  function selectSingle(mi: MenuItem, groupId: string, optionId: string) {
    setSelectedOptions((prev) => ({
      ...prev,
      [mi.id]: {
        ...(prev[mi.id] || {}),
        [groupId]: optionId,
      },
    }));
  }

  function toggleMulti(mi: MenuItem, groupId: string, optionId: string, gMeta: OptionGroup) {
    setSelectedOptions((prev) => {
      const byItem = { ...(prev[mi.id] || {}) };
      const bag = { ...(byItem[groupId] as Record<string, boolean> || {}) };
      const nextVal = !bag[optionId];

      const max = Number(gMeta?.max ?? Infinity);
      const currentCount = Object.values(bag).filter(Boolean).length;
      if (nextVal && Number.isFinite(max) && currentCount >= max) return prev;

      bag[optionId] = nextVal;
      byItem[groupId] = bag;
      return { ...prev, [mi.id]: byItem };
    });
  }

  function computeTotal(mi: MenuItem) {
    let total = Number(mi.price || 0);

    const addonBag = selectedAddons[mi.id] || {};
    for (const ad of (mi.addons || [])) {
      if (addonBag[ad.name]) {
        total += Number(ad.price || 0);
      }
    }

    const groups = itemGroups[mi.id] || [];
    const sel = selectedOptions[mi.id] || {};
    for (const g of groups) {
      const items = groupItems[g.id] || [];
      if (g.type === "single") {
        const selId = sel[g.id] as string;
        if (selId) {
          const found = items.find((it) => it.id === selId);
          if (found) total += Number(found.priceDelta || 0);
        }
      } else {
        const bag = sel[g.id] as Record<string, boolean> || {};
        for (const it of items) {
          if (bag[it.id]) total += Number(it.priceDelta || 0);
        }
      }
    }
    return total;
  }

  function buildCartPayload(mi: MenuItem) {
    const basePrice = Number(mi.price || 0);

    const addonBag = selectedAddons[mi.id] || {};
    const addonsPicked = (mi.addons || [])
      .filter((ad) => addonBag[ad.name])
      .map((ad) => ({ name: ad.name, price: Number(ad.price || 0) }));

    const groups = itemGroups[mi.id] || [];
    const sel = selectedOptions[mi.id] || {};
    const optionGroups = groups.map((g) => {
      const items = groupItems[g.id] || [];
      if (g.type === "single") {
        const selId = sel[g.id] as string;
        const it = selId ? items.find((x) => x.id === selId) : undefined;
        return {
          groupId: g.id,
          groupName: g.name,
          type: g.type || "single",
          items: it ? [{ id: it.id, name: it.name, priceDelta: Number(it.priceDelta || 0) }] : [],
        };
      } else {
        const bag = sel[g.id] as Record<string, boolean> || {};
        const chosen = items.filter((x) => bag[x.id]).map((x) => ({
          id: x.id,
          name: x.name,
          priceDelta: Number(x.priceDelta || 0),
        }));
        return {
          groupId: g.id,
          groupName: g.name,
          type: g.type || "multi",
          items: chosen,
        };
      }
    });

    // ===========================
    // NUEVO: totales en CENTAVOS
    // ===========================
    const qty = 1; // aquí siempre agregas 1
    const baseC = toCents(basePrice);

    const addonsC = addonsPicked.reduce((s, ad) => s + toCents(ad.price), 0);

    const optsC = optionGroups.reduce((sum, g) => {
      const gSum = (g.items || []).reduce((s, it) => s + toCents(it.priceDelta || 0), 0);
      return sum + gSum;
    }, 0);

    const unitPriceCents = baseC + addonsC + optsC;
    const lineSubtotalCents = unitPriceCents * qty;

    // Mantengo totalPrice numérico como antes para el resto del flujo/UI
    const totalPrice = computeTotal(mi);

    return {
      menuItemId: mi.id,
      menuItemName: mi.name,
      basePrice,
      quantity: qty,
      addons: addonsPicked,
      optionGroups,
      totalPrice,

      // 👇 NUEVO: campos exactos en centavos para el checkout / apply-promo
      unitPriceCents,
      lineSubtotalCents,
      totalPriceCents: lineSubtotalCents,
    };
  }

  function onAddToCart(mi: MenuItem) {
    const payload = buildCartPayload(mi);
    console.log("[ADD TO CART] payload listo:", payload);
    setAddingId(mi.id);
    try {
      if (newCart && typeof newCart.add === "function") {
        // Pasamos también los campos en centavos (no rompen nada si el cart los ignora)
        newCart.add({
          menuItemId: payload.menuItemId,
          menuItemName: payload.menuItemName,
          basePrice: payload.basePrice,
          quantity: payload.quantity,
          addons: payload.addons || [],
          optionGroups: payload.optionGroups || [],
          totalPrice: payload.totalPrice,

          // NUEVO: centavos
          unitPriceCents: payload.unitPriceCents,
          lineSubtotalCents: payload.lineSubtotalCents,
          totalPriceCents: payload.totalPriceCents,
        } as any);
      }
      // 👇 Dispara el mensaje “Agregado”
      setFlash({ id: mi.id, name: mi.name });
      window.clearTimeout((window as any).__flashTimer);
      (window as any).__flashTimer = window.setTimeout(() => setFlash(null), 1500);
    } finally {
      setAddingId(null);
    }
  }

  function groupSelectionCount(mi: MenuItem, g: OptionGroup) {
    if (g.type === "single") {
      const val = (selectedOptions[mi.id]?.[g.id] as string) || "";
      return val ? 1 : 0;
    }
    const bag = (selectedOptions[mi.id]?.[g.id] as Record<string, boolean>) || {};
    return Object.values(bag).filter(Boolean).length;
  }

  function groupIsInvalid(mi: MenuItem, g: OptionGroup) {
    const count = groupSelectionCount(mi, g);
    if (g.required && count === 0) return true;
    if (g.type === "multi") {
      if (typeof g.min === "number" && count < g.min) return true;
      if (typeof g.max === "number" && count > g.max) return true;
    }
    return false;
  }

  return (
    <div className="container py-4">
      <div className="d-flex align-items-center justify-content-between mb-3">
        <div>
          <div className="text-muted small">
            {tt("menu.subcat.breadcrumbPrefix", "Menu /")} {category?.name ?? tt("menu.subcat.categoryFallback", "Category")}
          </div>
          <h1 className="h4 m-0">{subcategory?.name ?? tt("menu.subcat.subcategoryFallback", "Subcategory")}</h1>
        </div>
        <div className="d-flex gap-2">
          <Link href={withTenant(`/app/menu/${catId}`)} className="btn btn-sm btn-outline-secondary">
            ← {tt("menu.subcat.backSubcats", "Subcategories")}
          </Link>
          <Link href={withTenant("/app/menu")} className="btn btn-sm btn-outline-secondary">
            {tt("menu.subcat.homeMenu", "Home menu")}
          </Link>
        </div>
      </div>

      <div className="row g-4">
        {items.map((it) => {
          const expanded = expandedItemId === it.id;
          const total = expanded ? computeTotal(it) : it.price;

          return (
            <div className="col-12 col-sm-6 col-lg-4" key={it.id}>
              <div className="card border-0 shadow-sm h-100 d-flex flex-column">
                {/* 👇 ÚNICO CAMBIO: hacer clic en la imagen también abre/cierra opciones */}
                <div
                  className="ratio ratio-4x3 rounded-top overflow-hidden"
                  role="button"
                  tabIndex={0}
                  onClick={() => onToggleOptions(it)}
                  title={tt("menu.subcat.openOptions", "Open options")}
                  style={{ cursor: "pointer" }}
                >
                  {it.imageUrl ? (
                    <Image
                      src={it.imageUrl}
                      alt={it.name}
                      fill
                      sizes="(max-width: 576px) 100vw, (max-width: 992px) 50vw, 33vw"
                      className="object-fit-cover"
                    />
                  ) : (
                    <div className="d-flex align-items-center justify-content-center bg-light text-muted">
                      {tt("common.noImage", "No image")}
                    </div>
                  )}
                </div>

                <div className="card-body d-flex flex-column">
                  <div className="d-flex justify-content-between align-items-start mb-2">
                    <div className="fw-semibold">{it.name}</div>
                    <div className="fw-semibold">{fmtQ(total)}</div>
                  </div>

                  {/* descripción en menú (no se pasa al carrito) */}
                  {it.description && (
                    <p className="text-muted small mb-2">{it.description}</p>
                  )}

                  {isDisabled(it) && (
                    <div className="badge text-bg-warning mb-2 align-self-start">{tt("common.notAvailable", "Not available")}</div>
                  )}

                  <div className="d-flex gap-2 mt-auto">
                    <button
                      type="button"
                      className="btn btn-outline-primary"
                      onClick={() => onToggleOptions(it)}
                    >
                      {expanded ? tt("menu.subcat.hideOptions", "Hide options") : tt("menu.subcat.options", "Options")}
                    </button>
                  </div>

                  {expanded && (
                    <div className="mt-3 border-top pt-3">
                      {!!(it.addons?.length) && (
                        <>
                          <div className="fw-semibold mb-2">{tt("menu.subcat.addons", "Addons")}</div>
                          <div className="d-flex flex-column gap-1 mb-2">
                            {it.addons!.map((ad, idx) => {
                              const checked = !!(selectedAddons[it.id]?.[ad.name]);
                              return (
                                <label key={idx} className="form-check d-flex justify-content-between align-items-center">
                                  <div>
                                    <input
                                      className="form-check-input me-2"
                                      type="checkbox"
                                      checked={checked}
                                      onChange={() => toggleAddon(it, ad.name)}
                                    />
                                    <span>{ad.name}</span>
                                  </div>
                                  <span className="text-muted small">{fmtQ(ad.price)}</span>
                                </label>
                              );
                            })}
                          </div>
                        </>
                      )}

                      {Array.isArray(it.optionGroupIds) && it.optionGroupIds.length > 0 && (
                        <>
                          <div className="fw-semibold mb-2">{tt("menu.subcat.options", "Options")}</div>
                          <div className="d-flex flex-column gap-3">
                            {(itemGroups[it.id] || [])
                              .filter((g) => g.active !== false)
                              .map((g) => {
                                const items = (groupItems[g.id] || []).filter((oi) => oi.active !== false);
                                const invalid = groupIsInvalid(it, g);
                                const count = groupSelectionCount(it, g);

                                return (
                                  <div key={g.id} className="border rounded p-2">
                                    <div className="d-flex align-items-center justify-content-between mb-2">
                                      <div>
                                        <div className="fw-semibold">{g.name}</div>
                                        <div className="text-muted small">
                                          {g.type === "single" ? tt("menu.subcat.meta.one", "One option") : tt("menu.subcat.meta.multi", "Multiple options")}
                                          {g.required ? ` · ${tt("menu.subcat.meta.required", "required")}` : ""}
                                          {typeof g.min === "number" ? ` · ${tt("menu.subcat.meta.min", "min {n}", { n: g.min })}` : ""}
                                          {typeof g.max === "number" ? ` · ${tt("menu.subcat.meta.max", "max {n}", { n: g.max })}` : ""}
                                        </div>
                                      </div>
                                      {g.type === "multi" && (
                                        <div className="text-muted small">{tt("menu.subcat.meta.selected", "Selected: {count}", { count })}</div>
                                      )}
                                    </div>

                                    <div className="d-flex flex-column gap-1">
                                      {g.type === "single" ? (
                                        items.map((oi) => {
                                          const selId = (selectedOptions[it.id]?.[g.id] as string) || "";
                                          const checked = selId === oi.id;
                                          return (
                                            <label key={oi.id} className="form-check d-flex justify-content-between align-items-center">
                                              <div>
                                                <input
                                                  className="form-check-input me-2"
                                                  type="radio"
                                                  name={`og_${it.id}_${g.id}`}
                                                  checked={checked}
                                                  onChange={() => selectSingle(it, g.id, oi.id)}
                                                />
                                                <span>{oi.name}</span>
                                              </div>
                                              <span className="text-muted small">{fmtQ(oi.priceDelta || 0)}</span>
                                            </label>
                                          );
                                        })
                                      ) : (
                                        items.map((oi) => {
                                          const bag = (selectedOptions[it.id]?.[g.id] as Record<string, boolean>) || {};
                                          const checked = !!bag[oi.id];
                                          const max = Number(g.max ?? Infinity);
                                          const currentCount = Object.values(bag).filter(Boolean).length;
                                          const disableExtra = !checked && Number.isFinite(max) && currentCount >= max;
                                          return (
                                            <label key={oi.id} className="form-check d-flex justify-content-between align-items-center">
                                              <div>
                                                <input
                                                  className="form-check-input me-2"
                                                  type="checkbox"
                                                  checked={checked}
                                                  disabled={disableExtra}
                                                  onChange={() => toggleMulti(it, g.id, oi.id, g)}
                                                />
                                                <span>{oi.name}</span>
                                              </div>
                                              <span className="text-muted small">{fmtQ(oi.priceDelta || 0)}</span>
                                            </label>
                                          );
                                        })
                                      )}
                                    </div>

                                    {invalid && (
                                      <div className="text-danger small mt-2">
                                        {tt("menu.subcat.invalidGroup", "Invalid selection for this group.")}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                          </div>
                        </>
                      )}

                      <div className="d-flex align-items-center justify-content-between mt-3">
                        <div className="fw-semibold">{tt("menu.subcat.total", "Total")}: {fmtQ(computeTotal(it))}</div>
                        <button
                          type="button"
                          className="btn btn-primary"
                          disabled={isDisabled(it) || addingId === it.id || (itemGroups[it.id] || []).some(g => groupIsInvalid(it, g))}
                          onClick={() => onAddToCart(it)}
                        >
                          {addingId === it.id ? tt("menu.subcat.adding", "Adding…") : tt("menu.subcat.addToCart", "Add to cart")}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          );
        })}

        {items.length === 0 && (
          <div className="col-12">
            <div className="alert alert-light border">{tt("menu.subcat.empty", "There are no items in this subcategory yet.")}</div>
          </div>
        )}
      </div>

      {/* Toast “Agregado” */}
      <div
        className={`position-fixed bottom-0 start-50 translate-middle-x mb-3 ${flash ? "" : "d-none"}`}
        style={{ zIndex: 1080 }}
        aria-live="polite"
        aria-atomic="true"
      >
        <div className="alert alert-success py-2 px-3 shadow-sm border-0 d-flex align-items-center gap-2">
          <span role="img" aria-label="check">✅</span>
          <span>{tt("menu.subcat.toastAdded", "Added")}</span>
        </div>
      </div>
    </div>
  );
}
