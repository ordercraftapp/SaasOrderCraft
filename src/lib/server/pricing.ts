// src/lib/server/pricing.ts
// ⚙️ Pricing engine (tenant-aware)

import { tColAdmin } from "@/lib/db_admin";
import { CartItemInput, PricingQuoteInput } from "@/lib/validators/cart";
// 👇 Asumo que también migraste estos helpers a multi-tenant (aceptan { tenantId }).
import { getPricingConfig, getCoupon } from "@/lib/server/config";

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;

// ===== Tipos (Firestore docs normalizados) =====
type MenuItemDoc = {
  id: string;
  name: string;
  price: number;
  currency: string;
  isActive: boolean;
  isAvailable: boolean;
};

type OptionGroupDoc = {
  id: string;
  menuItemId: string;
  name: string;
  minSelect: number;
  maxSelect: number;
  required?: boolean;
  isActive: boolean;
};

type OptionItemDoc = {
  id: string;
  groupId: string;
  menuItemId?: string;
  name: string;
  priceDelta: number;
  isActive: boolean;
};

// ===== API pública =====
export type LinePricing = {
  menuItemId: string;
  menuItemName: string;
  currency: string;
  basePrice: number;
  quantity: number;
  options: Array<{
    groupId: string;
    groupName: string;
    selected: Array<{ id: string; name: string; priceDelta: number }>;
    groupDeltaTotal: number;
  }>;
  unitPrice: number;
  lineTotal: number;
};

export type OrderQuote = {
  currency: string;
  items: LinePricing[];
  subtotal: number;
  serviceFee: number;
  discount: number;
  taxableBase: number;
  tax: number;
  tip: number;
  total: number;
  couponApplied?: string;
};

// ⬇️ Contexto de pricing (tenant obligatorio)
export type PricingContext = {
  tenantId?: string; // opcional en tipo, pero exigido en runtime para evitar colecciones globales
};

// ===== Helpers Firestore (tenant-scoped) =====
async function getMenuItem(id: string, tenantId: string): Promise<MenuItemDoc> {
  const snap = await tColAdmin("menuItems", tenantId).doc(id).get();
  if (!snap.exists) throw new Error("MENU_ITEM_NOT_FOUND");
  const d = snap.data() as any;

  // Compatibilidad con legacy
  const isActive = (d?.isActive ?? d?.active ?? true) === true;
  const isAvailable = (d?.isAvailable ?? d?.available ?? true) === true;
  if (!isActive || !isAvailable) throw new Error("MENU_ITEM_UNAVAILABLE");

  // Normalizar precio
  const price = Number.isFinite(Number(d?.price))
    ? Number(d?.price)
    : Number.isFinite(Number(d?.priceCents))
      ? Number(d?.priceCents) / 100
      : 0;

  return {
    id: snap.id,
    name: String(d?.name ?? d?.title ?? "Item"),
    price: Number(price) || 0,
    currency: String(d?.currency ?? "GTQ"),
    isActive,
    isAvailable,
  };
}

async function getActiveGroupsForItem(menuItemId: string, tenantId: string): Promise<OptionGroupDoc[]> {
  const q = await tColAdmin("optionGroups", tenantId)
    .where("menuItemId", "==", menuItemId)
    .where("isActive", "==", true)
    .limit(1000)
    .get();

  return q.docs.map((doc) => {
    const d = doc.data() as any;
    return {
      id: doc.id,
      menuItemId: d.menuItemId,
      name: d.name,
      minSelect: Number(d.minSelect ?? 0),
      maxSelect: Number(d.maxSelect ?? 1),
      required: d.required ?? (Number(d.minSelect ?? 0) >= 1),
      isActive: !!d.isActive,
    };
  });
}

async function getOptionItemsByIds(ids: string[], tenantId: string): Promise<OptionItemDoc[]> {
  if (!ids?.length) return [];
  const reads = ids.map((id) => tColAdmin("optionItems", tenantId).doc(id).get());
  const snaps = await Promise.all(reads);
  return snaps
    .filter((s) => s.exists)
    .map((s) => {
      const d = s.data() as any;
      return {
        id: s.id,
        groupId: d.groupId,
        menuItemId: d.menuItemId,
        name: d.name,
        priceDelta: Number(d.priceDelta || 0),
        isActive: !!d.isActive,
      };
    });
}

// ===== Motor principal =====
export async function priceCartItems(
  input: PricingQuoteInput,
  ctx?: PricingContext
): Promise<OrderQuote> {
  const tenantId = ctx?.tenantId;
  if (!tenantId) {
    // ✅ Impedimos cualquier uso sin tenant
    throw new Error("TENANT_REQUIRED_FOR_PRICING");
  }

  // ⚙️ Config de pricing por tenant
  const cfg = await getPricingConfig({ tenantId });

  const lines: LinePricing[] = [];
  let orderCurrency: string | undefined;
  let subtotal = 0;

  for (const item of input.items) {
    // Menu item
    const mi = await getMenuItem(item.menuItemId, tenantId);
    if (!orderCurrency) orderCurrency = mi.currency;
    if (orderCurrency !== mi.currency) throw new Error("CURRENCY_MISMATCH");

    // Grupos activos para el item
    const groups = await getActiveGroupsForItem(mi.id, tenantId);
    const groupsById = new Map(groups.map((g) => [g.id, g]));

    // Normalizar selecciones por grupo
    const selectionsByGroup = new Map<string, string[]>();
    for (const sel of item.options || []) {
      const unique = Array.from(new Set(sel.optionItemIds || []));
      selectionsByGroup.set(sel.groupId, unique);
    }

    // Validar que todos los grupos existan para este item
    for (const gid of selectionsByGroup.keys()) {
      if (!groupsById.has(gid)) throw new Error("INVALID_GROUP_FOR_ITEM");
    }

    // Validar min/max por grupo
    for (const g of groups) {
      const chosen = selectionsByGroup.get(g.id) || [];
      const count = chosen.length;
      if ((g.required || g.minSelect > 0) && count < g.minSelect) throw new Error("GROUP_MIN_VIOLATION");
      if (g.maxSelect >= 0 && count > g.maxSelect) throw new Error("GROUP_MAX_VIOLATION");
    }

    // Resolver OptionItems seleccionados
    const allChosenIds = Array.from(selectionsByGroup.values()).flat();
    const optionItems = await getOptionItemsByIds(allChosenIds, tenantId);
    const optionsById = new Map(optionItems.map((o) => [o.id, o]));

    // Validaciones por opción
    for (const [gid, chosenIds] of selectionsByGroup.entries()) {
      for (const oid of chosenIds) {
        const opt = optionsById.get(oid);
        if (!opt) throw new Error("OPTION_NOT_FOUND");
        if (!opt.isActive) throw new Error("OPTION_INACTIVE");
        if (opt.groupId !== gid) throw new Error("OPTION_WRONG_GROUP");
      }
    }

    // Calcular deltas por grupo
    const lineGroups: LinePricing["options"] = [];
    let deltasTotal = 0;

    for (const g of groups) {
      const chosen = selectionsByGroup.get(g.id) || [];
      if (chosen.length === 0) continue;

      const selected = chosen.map((oid) => {
        const o = optionsById.get(oid)!;
        return { id: o.id, name: o.name, priceDelta: o.priceDelta };
      });

      const groupDeltaTotal = selected.reduce((acc, s) => acc + Number(s.priceDelta || 0), 0);
      deltasTotal += groupDeltaTotal;

      lineGroups.push({
        groupId: g.id,
        groupName: g.name,
        selected,
        groupDeltaTotal: round2(groupDeltaTotal),
      });
    }

    const unitPrice = round2(Number(mi.price || 0) + deltasTotal);
    const qty = Number(item.quantity || 1);
    const lineTotal = round2(unitPrice * qty);

    const line: LinePricing = {
      menuItemId: mi.id,
      menuItemName: mi.name,
      currency: mi.currency,
      basePrice: round2(Number(mi.price || 0)),
      quantity: qty,
      options: lineGroups,
      unitPrice,
      lineTotal,
    };

    lines.push(line);
    subtotal = round2(subtotal + lineTotal);
  }

  // Service Fee
  const serviceFeeBase = cfg.serviceFeePercent > 0 ? subtotal * cfg.serviceFeePercent : 0;
  const serviceFee = round2(Math.max(0, cfg.serviceFeeFixed || 0) + serviceFeeBase);

  // Cupón (tenant-aware)
  let couponApplied: string | undefined;
  let discount = 0;
  const coupon = await getCoupon(input.couponCode, { tenantId });
  if (coupon && coupon.isActive) {
    if (coupon.currency && coupon.currency !== (orderCurrency || cfg.currency)) {
      // moneda no coincide → ignorar
    } else if (coupon.minSubtotal != null && subtotal < coupon.minSubtotal) {
      // no alcanza mínimo → ignorar
    } else {
      const discountBase =
        cfg.discountsApplyTo === "subtotal_plus_service" ? subtotal + serviceFee : subtotal;

      if (coupon.type === "percent") {
        discount = round2(discountBase * Math.max(0, Math.min(1, coupon.value)));
      } else {
        discount = round2(Math.max(0, coupon.value));
      }

      discount = Math.min(discount, discountBase);
      couponApplied = coupon.code;
    }
  }

  // Impuestos
  const taxableBase = round2(subtotal + serviceFee - discount);
  const tax = round2(Math.max(0, taxableBase * Math.max(0, cfg.taxRate)));

  // Propina
  let tip = 0;
  if (cfg.allowTips) {
    tip = round2(Math.max(0, Number(input.tipAmount || 0)));
  }

  const total = round2(taxableBase + tax + tip);

  return {
    currency: orderCurrency || cfg.currency,
    items: lines,
    subtotal,
    serviceFee,
    discount,
    taxableBase,
    tax,
    tip,
    total,
    couponApplied,
  };
}
