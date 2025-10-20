// src/app/(tenant)/[tenantId]/app/checkout-cards/page.tsx
'use client';

import React, { useMemo, useState, useEffect, useCallback, useRef, Suspense } from 'react';
import { useNewCart } from '@/lib/newcart/context';
import type { DineInInfo, DeliveryInfo } from '@/lib/newcart/types';
import { useRouter, useSearchParams } from 'next/navigation';
import '@/lib/firebase/client';


import {
  getFirestore,
  addDoc,
  serverTimestamp,
  getDocs, 
  query,
  where,
  orderBy,
  doc,
  getDoc,
} from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

import { getActiveTaxProfile } from '@/lib/tax/profile';
import { calculateTaxSnapshot } from '@/lib/tax/engine';
import { useFmtQ } from '@/lib/settings/money';
import { useAvailableTables } from '@/lib/tables/useAvailableTables';

/* 🔤 i18n */
import { t as translate } from '@/lib/i18n/t';
import { useTenantSettings } from '@/lib/settings/hooks';

/* Phase C: tenant en cliente */
import { useTenantId } from '@/lib/tenant/context';

/* Fase D: helpers Firestore namespaced */
import { tCol } from '@/lib/db';

type PickupInfo = { type: 'pickup'; phone: string; notes?: string };
type DeliveryOption = { id: string; title: string; description?: string; price: number; isActive?: boolean; sortOrder?: number; };
type Addr = { line1?: string; city?: string; country?: string; zip?: string; notes?: string };
type PayMethod = 'cash' | 'paypal';

type AppliedPromo = {
  promoId: string;
  code: string;
  discountTotalCents: number;
  discountByLine: Array<{ lineId: string; menuItemId: string; discountCents: number; eligible: boolean; lineSubtotalCents: number; }>;
};

/* --------------------------------------------
   🔤 Helper i18n
--------------------------------------------- */
function useLangTT() {
  const { settings } = useTenantSettings();
  const [lang, setLang] = React.useState<string | null>(null);

  React.useEffect(() => {
    let l = (settings as any)?.language || 'en';
    try {
      const ls = localStorage.getItem('tenant.language');
      if (ls) l = ls;
    } catch {}
    setLang(l);
  }, [settings]);

  const tt = React.useCallback(
    (key: string, fallback: string, vars?: Record<string, unknown>) =>
      translate(lang || 'en', key, vars) ?? fallback,
    [lang]
  );

  return { lang, tt, ready: lang != null } as const;
}

// --- helper: verifica claim por-tenant antes de leer Firestore
async function userHasTenantClaim(u: any, tenantId: string) {
  const tok = await u.getIdTokenResult(true);
  const t = (tok?.claims as any)?.tenants || {};
  return !!t[tenantId];
}

async function getClaims(u: any) {
  const tok = await u.getIdTokenResult(true);
  return tok?.claims || {};
}

/* --------------------------------------------
   🔧 /paymentProfile/default (por tenant)
   >>> CAMBIADO: ahora refresca claims con refresh-role antes de leer el doc
--------------------------------------------- */
function usePaymentProfile() {
  const tenantId = useTenantId();
  const [flags, setFlags] = useState<{ cash: boolean; paypal: boolean }>({ cash: true, paypal: false });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;

    (async () => {
      try {
        const auth = getAuth();
        const u = auth.currentUser;

        if (!u) {
          if (!cancelled) { setFlags({ cash: true, paypal: false }); setLoading(false); }
          return;
        }

        // 1) refrescar token
        const idToken = await u.getIdToken(true);

        // 2) pedir refresco de claims por tenant (opcional; tu endpoint)
        try {
          const resp = await fetch(`/${tenantId}/app/api/auth/refresh-role`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${idToken}` },
            cache: 'no-store',
            credentials: 'same-origin',
          });
          if (resp?.ok) {
            // fuerza recarga local de claims
            await u.getIdToken(true);
          }
        } catch {}

        // 3) si aún no hay claim del tenant, NO intentes leer (evita permission-denied)
        if (!(await userHasTenantClaim(u, tenantId))) {
          if (!cancelled) { setFlags({ cash: true, paypal: false }); setLoading(false); }
          return;
        }

        // 4) ahora sí, leer paymentProfile
        const db = getFirestore();
        const ref = doc(tCol('paymentProfile', tenantId), 'default');
        const snap = await getDoc(ref);

        if (cancelled) return;

        if (snap.exists()) {
          const data: any = snap.data() || {};
          const src = (data?.payments ?? data) || {};
          setFlags({ cash: !!src.cash, paypal: !!src.paypal });
        } else {
          setFlags({ cash: true, paypal: false });
        }
      } catch (e) {
        console.warn('paymentProfile read failed:', e);
        if (!cancelled) setFlags({ cash: true, paypal: false });
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [tenantId]);

  return { flags, loading };
}


/** Convierte undefined -> null (para orderInfo) */
function undefToNullDeep<T>(value: T): T {
  if (Array.isArray(value)) return value.map(undefToNullDeep) as any;
  if (value && typeof value === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(value)) out[k] = v === undefined ? null : undefToNullDeep(v as any);
    return out;
  }
  return (value === undefined ? (null as any) : value) as T;
}

/** Detector de dispositivo/origen */
function detectOrderSource() {
  try {
    if (typeof window === 'undefined') {
      return {
        orderSource: 'web:unknown',
        deviceInfo: { os: 'unknown', isMobile: false, ua: '' as string, brands: [] as string[] },
      };
    }
    const nav: any = window.navigator || {};
    const ua: string = String(nav.userAgent || '');
    const uaLower = ua.toLowerCase();
    const uaData = nav.userAgentData || null;
    const chPlatform = String(uaData?.platform || '').toLowerCase();
    const legacyPlatform = String(nav.platform || '').toLowerCase();
    const brandsArr: string[] = Array.isArray(uaData?.brands)
      ? uaData.brands.map((b: any) => String(b.brand || b.brandName || '')).filter(Boolean)
      : [];
    const hasTouch = (('maxTouchPoints' in nav) ? Number(nav.maxTouchPoints) > 0 : 'ontouchstart' in window);
    const pointerCoarse = typeof window.matchMedia === 'function'
      ? window.matchMedia('(pointer:coarse)').matches
      : false;
    const smallViewport = typeof window.matchMedia === 'function'
      ? window.matchMedia('(max-width: 812px)').matches
      : (window.innerWidth && window.innerWidth <= 812);

    const isAndroid =
      /android/.test(uaLower) ||
      /android/.test(chPlatform) ||
      /android/.test(legacyPlatform) ||
      brandsArr.some((b) => /android|chrome on android/i.test(b));

    const isIOSFamily =
      /iphone|ipad|ipod/.test(uaLower) ||
      ((/mac/.test(chPlatform) || /mac/.test(legacyPlatform) || /mac os x|macintosh/.test(uaLower)) && Number(nav.maxTouchPoints || 0) > 2) ||
      brandsArr.some((b) => /ios|safari on ios|mobile safari/i.test(b));

    let os: 'android' | 'ios' | 'windows' | 'macos' | 'linux' | 'unknown' = 'unknown';
    if (isAndroid) os = 'android';
    else if (isIOSFamily) os = 'ios';
    else if (/windows nt/.test(uaLower) || /win/.test(chPlatform) || /win/.test(legacyPlatform)) os = 'windows';
    else if (/mac os x|macintosh/.test(uaLower) || /mac/.test(chPlatform) || /mac/.test(legacyPlatform)) os = 'macos';
    else if (/linux/.test(uaLower) || /linux/.test(chPlatform) || /linux/.test(legacyPlatform)) os = 'linux';

    const isMobile =
      (uaData?.mobile === true) ||
      /mobi|iphone|ipad|ipod|phone|tablet/.test(uaLower) ||
      isAndroid || isIOSFamily ||
      (hasTouch && (pointerCoarse || smallViewport));

    const orderSource = `web:${isMobile ? 'mobile' : 'desktop'}`;

    return {
      orderSource,
      deviceInfo: {
        os,
        isMobile: !!isMobile,
        ua,
        brands: brandsArr,
      },
    };
  } catch {
    return {
      orderSource: 'web:unknown',
      deviceInfo: { os: 'unknown', isMobile: false, ua: '', brands: [] as string[] },
    };
  }
}

/* ============ Estado/Cálculos del Checkout (TENANT-AWARE) ============ */
function useCheckoutState() {
  const tenantId = useTenantId();
  const cart = useNewCart();
  const subtotal = useMemo(() => cart.computeGrandTotal(), [cart, cart.items]);
  const searchParams = useSearchParams();

  const [mode, setMode] = useState<'dine-in' | 'delivery' | 'pickup'>('dine-in');
  const [table, setTable] = useState('');
  const [notes, setNotes] = useState('');
  const [address, setAddress] = useState('');
  const [phone, setPhone] = useState('');
  const [customerName, setCustomerName] = useState<string>('');
  const [homeAddr, setHomeAddr] = useState<Addr | null>(null);
  const [officeAddr, setOfficeAddr] = useState<Addr | null>(null);
  const [addressLabel, setAddressLabel] = useState<'' | 'home' | 'office'>('');
  const [deliveryOptions, setDeliveryOptions] = useState<DeliveryOption[]>([]);
  const [selectedDeliveryOptionId, setSelectedDeliveryOptionId] = useState<string>('');
  const [tip, setTip] = useState<number>(0);
  const [tipEdited, setTipEdited] = useState<boolean>(false);
  const [saving, setSaving] = useState(false);
  const [payMethod, setPayMethod] = useState<PayMethod>('cash');

  const [promoCode, setPromoCode] = useState('');
  const [promoApplying, setPromoApplying] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [promo, setPromo] = useState<AppliedPromo | null>(null);
  const promoDiscountGTQ = useMemo(() => (promo?.discountTotalCents ?? 0) / 100, [promo]);

  const [customerTaxId, setCustomerTaxId] = useState<string>('');
  const [customerBillingName, setCustomerBillingName] = useState<string>('');

  const [activeProfile, setActiveProfile] = useState<any | null>(null);
  const [taxUI, setTaxUI] = useState<{
    pricesIncludeTax: boolean;
    currency: string;
    subTotalQ: number;
    taxQ: number;
    itemsGrandQ: number;
    grandPayableQ: number;
  } | null>(null);

  const router = useRouter();
  const db = getFirestore();

  // Helper: prefijar rutas con /{tenantId}
  const withTenant = useCallback((p: string) => {
    if (!tenantId) return p;
    const norm = p.startsWith('/') ? p : `/${p}`;
    if (norm.startsWith(`/${tenantId}/`)) return norm;
    return `/${tenantId}${norm}`;
  }, [tenantId]);

  const { available: availableTables, loading: tablesLoading } = useAvailableTables();

  useEffect(() => {
    const qpType = (searchParams?.get('type') || '').toLowerCase();
    const qpTable = (searchParams?.get('table') || '').trim();

    if (qpType === 'delivery' || qpType === 'pickup' || qpType === 'dine-in') {
      setMode(qpType as any);
    }
    if (qpTable && availableTables.includes(qpTable)) {
      setTable(qpTable);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams, availableTables.length]);

  // Cargar datos del cliente (tenant-aware via PATH)
  useEffect(() => {
    const run = async () => {
      try {
        const auth = getAuth();
        const u = auth.currentUser;
        if (!u) return;
        const token = await u.getIdToken();
        const res = await fetch(withTenant('/app/api/customers/me'), {
          headers: {
            Authorization: `Bearer ${token}`,
            'x-tenant': tenantId || '',
          },
          cache: 'no-store',
        });
        if (!res.ok) return;
        const data = await res.json();
        const c = data?.customer;
        if (!c) return;

        setCustomerName(c.displayName || u.displayName || '');
        if (c.phone && !phone) setPhone(c.phone);

        const taxId = c?.taxID ? String(c.taxID) : (c?.billing?.taxId ? String(c.billing.taxId) : '');
        if (taxId) setCustomerTaxId(taxId);
        const bName = c?.billing?.name ? String(c.billing.name) : '';
        if (bName) setCustomerBillingName(bName);

        const h: Addr | null = c.addresses?.home || null;
        const o: Addr | null = c.addresses?.office || null;
        setHomeAddr(h);
        setOfficeAddr(o);

        const hasHome = !!(h && h.line1 && String(h.line1).trim());
        const hasOffice = !!(o && o.line1 && String(o.line1).trim());
        if (hasHome) {
          setAddressLabel('home');
          setAddress(String(h!.line1));
        } else if (hasOffice) {
          setAddressLabel('office');
          setAddress(String(o!.line1));
        }
      } catch {}
    };
    run();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  // Opciones de delivery (Firestore namespaced)
  useEffect(() => {
    if (!tenantId) return;
    let cancelled = false;
    const load = async () => {
      if (mode !== 'delivery') {
        setDeliveryOptions([]);
        setSelectedDeliveryOptionId('');
        return;
      }
      try {
        const qRef = query(
          tCol('deliveryOptions', tenantId),
          where('isActive', '==', true),
          orderBy('sortOrder', 'asc')
        );
        const snap = await getDocs(qRef);        
        if (cancelled) return;
        const arr = snap.docs.map((d) => {
          const raw = d.data() as any;
          return {
            id: d.id,
            title: String(raw.title ?? ''),
            description: raw.description ? String(raw.description) : undefined,
            price: Number(raw.price ?? 0),
            isActive: Boolean(raw.isActive ?? true),
            sortOrder: Number.isFinite(raw.sortOrder) ? Number(raw.sortOrder) : undefined,
          } as DeliveryOption;
        });
        setDeliveryOptions(arr);
        if (!selectedDeliveryOptionId && arr.length > 0) {
          setSelectedDeliveryOptionId(arr[0].id);
        }
      } catch {
        try {
          const qRef = query(
            tCol('deliveryOptions', tenantId),
            where('isActive', '==', true)
          );
          const snap = await getDocs(qRef);          
          if (cancelled) return;
          const arr = snap.docs
            .map((d) => {
              const raw = d.data() as any;
              return {
                id: d.id,
                title: String(raw.title ?? ''),
                description: raw.description ? String(raw.description) : undefined,
                price: Number(raw.price ?? 0),
                isActive: Boolean(raw.isActive ?? true),
                sortOrder: Number.isFinite(raw.sortOrder) ? Number(raw.sortOrder) : undefined,
              } as DeliveryOption;
            })
            .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
          setDeliveryOptions(arr);
          if (!selectedDeliveryOptionId && arr.length > 0) {
            setSelectedDeliveryOptionId(arr[0].id);
          }
        } catch {
          setDeliveryOptions([]);
        }
      }
    };
    load();
    return () => { cancelled = true; };
  }, [mode, tenantId, selectedDeliveryOptionId]);

  // Tip sugerido
  useEffect(() => {
    if (mode === 'delivery') {
      if (!tipEdited) setTip(0);
      return;
    }
    if (!tipEdited) {
      const suggested = Math.round(subtotal * 0.1 * 100) / 100;
      setTip(suggested);
    }
  }, [mode, subtotal, tipEdited]);

  const deliveryFee = useMemo(() => {
    if (mode !== 'delivery') return 0;
    const opt = deliveryOptions.find((o) => o.id === selectedDeliveryOptionId);
    return Number(opt?.price || 0);
  }, [mode, deliveryOptions, selectedDeliveryOptionId]);

  useEffect(() => {
    (async () => {
      const p = await getActiveTaxProfile(); // asume profile por tenant (si no, ajústalo)
      setActiveProfile(p || null);
    })();
  }, []);

  // Impuestos/total
  useEffect(() => {
    const toCents = (n: number | undefined | null) => Math.round(((n as number) || 0) * 100);

    const zeroProfile: any = {
      id: 'no-tax',
      country: 'GT',
      currency: process.env.NEXT_PUBLIC_PAY_CURRENCY || 'USD',
      pricesIncludeTax: true,
      rounding: 'half_up',
      rates: [{ code: 'ALL', label: 'No tax', rateBps: 0, appliesTo: 'all' }],
      surcharges: [],
      delivery: { mode: 'as_line', taxable: false },
    };

    const profile = activeProfile || zeroProfile;

    const linesForTax = cart.items.map((ln: any) => {
      const perUnitTotal = cart.computeLineTotal({ ...ln, quantity: 1 });
      const perUnitExtras = perUnitTotal - ln.basePrice;
      return {
        lineId: ln.menuItemId + '-' + (Math.random().toString(36).slice(2)),
        quantity: ln.quantity,
        unitPriceCents: toCents(ln.basePrice),
        addonsCents: 0,
        optionsDeltaCents: toCents(perUnitExtras),
        lineTotalCents: undefined,
        taxExempt: false,
        name: ln.menuItemName,
      };
    });

    let addressInfo: any = undefined;
    if (mode === 'delivery') {
      const selectedAddr = addressLabel === 'home' ? homeAddr
                        : addressLabel === 'office' ? officeAddr
                        : null;
      addressInfo = selectedAddr ? {
        line1: selectedAddr.line1 || '',
        city: selectedAddr.city || '',
        country: selectedAddr.country || '',
        zip: selectedAddr.zip || '',
        notes: selectedAddr.notes || '',
      } : {
        line1: address || '',
        city: homeAddr?.city || officeAddr?.city || '',
        country: homeAddr?.country || officeAddr?.country || '',
        zip: homeAddr?.zip || officeAddr?.zip || '',
      };
    }

    const draftInput = {
      currency: profile?.currency ?? 'USD',
      orderType: mode,
      lines: linesForTax,
      customer: {
        taxId: customerTaxId || undefined,
        name: customerBillingName || customerName || undefined,
      },
      deliveryFeeCents:
        (profile?.delivery?.mode === 'as_line' && mode === 'delivery')
          ? toCents(deliveryFee)
          : 0,
      deliveryAddressInfo: mode === 'delivery' ? (addressInfo || null) : null,
    };

    const snap = calculateTaxSnapshot(draftInput as any, profile as any);
    const subQ = (snap?.totals?.subTotalCents || 0) / 100;
    const taxQ = (snap?.totals?.taxCents || 0) / 100;
    const itemsGrandQ = (snap?.totals?.grandTotalCents || 0) / 100;

    const tipQ = mode === 'delivery' ? 0 : tip;
    const discountQ = promoDiscountGTQ;
    const deliveryOutsideQ =
      (profile?.delivery?.mode === 'as_line') ? 0 : deliveryFee;

    const grandPayableQ = itemsGrandQ + deliveryOutsideQ + tipQ - discountQ;

    setTaxUI({
      pricesIncludeTax: !!profile?.pricesIncludeTax,
      currency: snap?.currency || profile?.currency || 'USD',
      subTotalQ: subQ,
      taxQ,
      itemsGrandQ,
      grandPayableQ,
    });
  }, [
    activeProfile, cart.items, mode, deliveryFee, tip, promoDiscountGTQ,
    addressLabel, address, homeAddr, officeAddr, customerTaxId, customerBillingName, customerName,
    cart
  ]);

  const hasDropdown =
    (homeAddr && homeAddr.line1 && String(homeAddr.line1).trim() !== '') ||
    (officeAddr && officeAddr.line1 && String(officeAddr.line1).trim() !== '');

  function onChangeAddressLabel(value: 'home' | 'office') {
    setAddressLabel(value);
    const src = value === 'home' ? homeAddr : officeAddr;
    setAddress(src?.line1 ? String(src.line1) : '');
  }

  const grandTotal = useMemo(() => {
    const t = (mode === 'delivery' ? 0 : tip) || 0;
    return subtotal + deliveryFee + t - promoDiscountGTQ;
  }, [subtotal, deliveryFee, tip, mode, promoDiscountGTQ]);

  // Aplicar cupon (tenant-aware PATH)
  const applyPromo = useCallback(async () => {
    setPromoError(null);
    const code = (promoCode || '').trim().toUpperCase();
    if (!code) { setPromoError('Enter the coupon.'); return; }
    setPromoApplying(true);
    try {
      const auth = getAuth();
      const u = auth.currentUser;

      const lines = cart.items.map((ln: any, idx: number) => ({
        lineId: String(idx),
        menuItemId: ln.menuItemId,
        totalPriceCents: Math.round(cart.computeLineTotal(ln) * 100),
      }));

      const res = await fetch(withTenant('/app/api/cart/apply-promo'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-tenant': tenantId || '' },
        body: JSON.stringify({
          code,
          orderType: mode,
          userUid: u?.uid || null,
          lines,
        }),
      });
      const j = await res.json();
      if (!res.ok || !j?.ok) {
        setPromo(null);
        setPromoError(j?.reason || 'Invalid coupon.');
        return;
      }
      setPromo({
        promoId: j.promoId,
        code: j.code,
        discountTotalCents: j.discountTotalCents,
        discountByLine: j.discountByLine || [],
      });
      setPromoError(null);
    } catch (e: any) {
      setPromo(null);
      setPromoError('The coupon could not be validated.');
    } finally {
      setPromoApplying(false);
    }
  }, [promoCode, cart.items, mode, tenantId, cart, withTenant]);

  const clearPromo = useCallback(() => {
    setPromo(null);
    setPromoCode('');
    setPromoError(null);
  }, []);

  const buildOrderPayload = useCallback(async () => {
    const meta: DineInInfo | DeliveryInfo | PickupInfo =
      mode === 'dine-in'
        ? { type: 'dine-in', table, notes: notes || undefined }
        : mode === 'delivery'
        ? { type: 'delivery', address, phone, notes: notes || undefined }
        : { type: 'pickup', phone, notes: notes || undefined };

    const auth = getAuth();
    const u = auth.currentUser;

    let orderInfo: any = meta;
    if (mode === 'delivery') {
      const selectedAddr = addressLabel === 'home' ? homeAddr
                        : addressLabel === 'office' ? officeAddr
                        : null;
      const addressInfo = selectedAddr ? {
        line1: selectedAddr.line1 || '',
        city: selectedAddr.city || '',
        country: selectedAddr.country || '',
        zip: selectedAddr.zip || '',
        notes: selectedAddr.notes || '',
      } : undefined;

      const selectedOpt = deliveryOptions.find((o) => o.id === selectedDeliveryOptionId);
      orderInfo = {
        ...(meta as DeliveryInfo),
        delivery: 'pending',
        customerName: customerName || u?.displayName || undefined,
        addressLabel: addressLabel || undefined,
        addressInfo,
        addressNotes: selectedAddr?.notes || undefined,
        deliveryOptionId: selectedOpt?.id || undefined,
        deliveryOption: selectedOpt
          ? { title: selectedOpt.title, description: selectedOpt.description || '', price: Number(selectedOpt.price || 0) }
          : undefined,
      };
    }

    const { orderSource, deviceInfo } = detectOrderSource();
    (orderInfo as any).orderSource = orderSource;
    (orderInfo as any).deviceInfo = deviceInfo;

    const cleanOrderInfo = undefToNullDeep(orderInfo);

    const appliedPromotions = promo ? [{
      promoId: promo.promoId,
      code: promo.code,
      discountTotalCents: promo.discountTotalCents,
      discountTotal: (promo.discountTotalCents / 100),
      byLine: promo.discountByLine,
    }] : [];

    const toCents = (n: number | undefined | null) => Math.round(((n as number) || 0) * 100);

    const active = await getActiveTaxProfile();
    const zeroProfile = {
      id: 'no-tax',
      country: 'GT',
      currency: process.env.NEXT_PUBLIC_PAY_CURRENCY || 'USD',
      pricesIncludeTax: true,
      rounding: 'half_up',
      rates: [{ code: 'ALL', label: 'No tax', rateBps: 0, appliesTo: 'all' }],
      surcharges: [],
      delivery: { mode: 'as_line', taxable: false },
    } as const;

    const profile = active || (zeroProfile as any);

    const linesForTax = cart.items.map((ln: any) => {
      const perUnitTotal = cart.computeLineTotal({ ...ln, quantity: 1 });
      const perUnitExtras = perUnitTotal - ln.basePrice;
      return {
        lineId: ln.menuItemId + '-' + (Math.random().toString(36).slice(2)),
        quantity: ln.quantity,
        unitPriceCents: toCents(ln.basePrice),
        addonsCents: 0,
        optionsDeltaCents: toCents(perUnitExtras),
        lineTotalCents: undefined,
        taxExempt: false,
        name: ln.menuItemName,
      };
    });

    const orderTypeForTax = mode;
    const rawDeliveryFeeCents = toCents(mode === 'delivery' ? deliveryFee : 0);

    const draftInput = {
      currency: profile?.currency ?? 'USD',
      orderType: orderTypeForTax,
      lines: linesForTax,
      customer: {
        taxId: customerTaxId || undefined,
        name: customerBillingName || customerName || undefined,
      },
      deliveryFeeCents:
        (profile?.delivery?.mode === 'as_line' && mode === 'delivery')
          ? toCents(deliveryFee)
          : 0,
      deliveryAddressInfo:
        mode === 'delivery'
          ? ((orderInfo as any)?.addressInfo ?? {
              country: homeAddr?.country || officeAddr?.country,
              city: homeAddr?.city || officeAddr?.city,
              zip: homeAddr?.zip || officeAddr?.zip,
              line1: address || homeAddr?.line1 || officeAddr?.line1,
              notes: (orderInfo as any)?.addressNotes || undefined,
            })
          : null,
    };

    const taxSnapshot = calculateTaxSnapshot(draftInput as any, profile as any);

    const tipCents = toCents(mode === 'delivery' ? 0 : tip);
    const discountCents = promo?.discountTotalCents ?? 0;

    const deliveryOutsideCents =
      (profile?.delivery?.mode === 'as_line')
        ? 0
        : rawDeliveryFeeCents;

    const grandTotalWithTaxCents =
      (taxSnapshot?.totals?.grandTotalCents || 0)
      + deliveryOutsideCents
      + tipCents
      - discountCents;

    const grandTotalWithTax = grandTotalWithTaxCents / 100;

    return {
      items: cart.items.map((ln) => ({
        menuItemId: ln.menuItemId,
        menuItemName: ln.menuItemName,
        basePrice: ln.basePrice,
        quantity: ln.quantity,
        addons: ln.addons.map((a) => ({ name: a.name, price: a.price })),
        optionGroups: ln.optionGroups.map((g) => ({
          groupId: g.groupId,
          groupName: g.groupName,
          type: g.type || 'single',
          items: g.items.map((it: any) => ({ id: it.id, name: it.name, priceDelta: it.priceDelta })),
        })),
        lineTotal: cart.computeLineTotal(ln),
      })),
      orderTotal: grandTotal,
      orderInfo: cleanOrderInfo,
      totals: {
        subtotal,
        deliveryFee,
        tip: mode === 'delivery' ? 0 : tip,
        discount: promoDiscountGTQ,
        currency: process.env.NEXT_PUBLIC_PAY_CURRENCY || 'USD',
        tax: (taxSnapshot?.totals?.taxCents || 0) / 100,
        grandTotalWithTax,
      },
      totalsCents: {
        itemsSubTotalCents: taxSnapshot?.totals?.subTotalCents ?? 0,
        itemsTaxCents: taxSnapshot?.totals?.taxCents ?? 0,
        itemsGrandTotalCents: taxSnapshot?.totals?.grandTotalCents ?? 0,
        deliveryFeeCents: rawDeliveryFeeCents,
        tipCents,
        discountCents,
        grandTotalWithTaxCents,
        currency: draftInput.currency,
      },
      taxSnapshot: taxSnapshot ? undefToNullDeep(taxSnapshot) : null,
      appliedPromotions,
      promotionCode: promo?.code || null,
      status: 'placed',
      createdAt: serverTimestamp(),
      ...(u ? {
        userEmail: u.email,
        userEmail_lower: u.email?.toLowerCase() || undefined,
        createdBy: { uid: u.uid, email: u.email ?? null }
      } : {}),
    };
  }, [
    address, addressLabel, customerName, customerBillingName, customerTaxId,
    deliveryFee, deliveryOptions, grandTotal, homeAddr, mode, notes, officeAddr, phone,
    selectedDeliveryOptionId, subtotal, table, tip, promoDiscountGTQ, promo, cart
  ]);

  return {
    state: {
      mode, table, notes, address, phone, customerName,
      homeAddr, officeAddr, addressLabel, deliveryOptions, selectedDeliveryOptionId,
      tip, tipEdited, saving, payMethod, hasDropdown, subtotal, deliveryFee, grandTotal,
      promoCode, promoApplying, promoError, promo,
      taxUI,
      availableTables,
      tablesLoading,
    },
    actions: {
      setMode, setTable, setNotes, setAddress, setPhone, setAddressLabel,
      setSelectedDeliveryOptionId, setTip, setTipEdited, setSaving, setPayMethod,
      onChangeAddressLabel, setPromoCode, applyPromo, clearPromo,
    },
    helpers: { buildOrderPayload, cart, db, router, withTenant, tenantId },
  } as const;
}

/** ------- UI (efectivo + PayPal, sin Stripe) ------- */
function CheckoutUI(props: {
  state: ReturnType<typeof useCheckoutState>['state'],
  actions: ReturnType<typeof useCheckoutState>['actions'],
  onSubmitCash: () => Promise<void>,
  paypalActiveHint?: string,
  cart: ReturnType<typeof useCheckoutState>['helpers']['cart'],
}) {
  const { state, actions, onSubmitCash, paypalActiveHint, cart } = props;
  const {
    mode, table, notes, address, phone, customerName,
    homeAddr, officeAddr, addressLabel, deliveryOptions, selectedDeliveryOptionId,
    tip, tipEdited, saving, payMethod, hasDropdown, subtotal, deliveryFee, grandTotal,
    promoCode, promoApplying, promoError, promo,
    taxUI,
    availableTables, tablesLoading,
  } = state;

  const {
    setMode, setTable, setNotes, setAddress, setPhone, setAddressLabel,
    setSelectedDeliveryOptionId, setTip, setTipEdited, setSaving, setPayMethod,
    onChangeAddressLabel, setPromoCode, applyPromo, clearPromo,
  } = actions;

  // ⚠️ Ejecuta TODOS los hooks antes de cualquier return condicional
  const { tt, ready } = useLangTT();
  const fmtQ = useFmtQ();
  const { flags: paymentsFlags, loading: paymentsLoading } = usePaymentProfile();

  useEffect(() => {
    if (paymentsLoading) return;
    if (payMethod === 'paypal' && !paymentsFlags.paypal) {
      setPayMethod('cash');
    }
    if (payMethod === 'cash' && !paymentsFlags.cash && paymentsFlags.paypal) {
      setPayMethod('paypal');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentsFlags.cash, paymentsFlags.paypal, paymentsLoading]);

  // ⛔️ Recién aquí hacemos el gate de render para evitar error #310
  if (!ready) return <div className="container py-4">Loading…</div>;

  const submitMethodDisabled =
    (payMethod === 'paypal' && !paymentsFlags.paypal) ||
    (payMethod === 'cash' && !paymentsFlags.cash);

  const disableSubmit =
    saving ||
    submitMethodDisabled ||
    (mode === 'dine-in' ? !table.trim() :
     mode === 'delivery' ? !(address && phone && selectedDeliveryOptionId) :
     !phone);

  const grandToShow = (taxUI?.grandPayableQ ?? grandTotal);

  const promoErrorText = promoError === 'Enter the coupon.'
    ? tt('checkout.promo.error.enter', 'Enter the coupon.')
    : promoError === 'Invalid coupon.'
    ? tt('checkout.promo.error.invalid', 'Invalid coupon.')
    : promoError === 'The coupon could not be validated.'
    ? tt('checkout.promo.error.validate', 'The coupon could not be validated.')
    : (promoError || null);

  return (
    <div className="container py-4">
      <h1 className="h4 mb-3">{tt('checkout.title', 'Checkout')}</h1>

      <div className="row g-4">
        <div className="col-12 col-lg-7">
          <div className="card border-0 shadow-sm">
            <div className="card-header"><div className="fw-semibold">{tt('checkout.details', 'Details')}</div></div>
            <div className="card-body">
              {/* Tipo de pedido */}
              <div className="mb-3">
                <label className="form-label fw-semibold">{tt('checkout.orderType', 'Order type')}</label>
                <div className="d-flex gap-2">
                  <button className={`btn ${mode === 'dine-in' ? 'btn-primary' : 'btn-outline-primary'}`} onClick={() => { setMode('dine-in'); setTipEdited(false); }} disabled={saving}>{tt('checkout.type.dinein', 'Dine-in')}</button>
                  <button className={`btn ${mode === 'delivery' ? 'btn-primary' : 'btn-outline-primary'}`} onClick={() => { setMode('delivery'); setTipEdited(false); }} disabled={saving}>{tt('checkout.type.delivery', 'Delivery')}</button>
                  <button className={`btn ${mode === 'pickup' ? 'btn-primary' : 'btn-outline-primary'}`} onClick={() => { setMode('pickup'); setTipEdited(false); }} disabled={saving}>{tt('checkout.type.pickup', 'Pickup')}</button>
                </div>
              </div>

              {mode === 'dine-in' && (
                <>
                  <div className="mb-3">
                    <label className="form-label">{tt('checkout.table.label', 'Table')}</label>
                    {tablesLoading ? (
                      <div className="form-text">{tt('checkout.table.loading', 'Loading tables…')}</div>
                    ) : availableTables.length === 0 ? (
                      <div className="alert alert-warning py-2 mb-2">
                        {tt('checkout.table.none', 'No tables available right now.')}
                      </div>
                    ) : (
                      <select
                        className="form-select"
                        value={table}
                        onChange={(e) => setTable(e.target.value)}
                        disabled={saving}
                      >
                        <option value="">{tt('checkout.table.selectPh', 'Select a table…')}</option>
                        {availableTables.map((t: string) => (
                          <option key={t} value={t}>
                            {tt('checkout.table.option', 'Table {t}', { t })}
                          </option>
                        ))}
                      </select>
                    )}
                  </div>

                  <div className="mb-3">
                    <label className="form-label">{tt('checkout.notes.label', 'Notes (optional)')}</label>
                    <textarea className="form-control" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={tt('checkout.notes.ph', 'Additional instructions')} disabled={saving} />
                  </div>
                </>
              )}

              {mode === 'delivery' && (
                <>
                  <div className="mb-3">
                    <label className="form-label">{tt('checkout.address.label', 'Address')}</label>
                    {hasDropdown ? (
                      <>
                        <select className="form-select" value={addressLabel || ''} onChange={(e) => onChangeAddressLabel(e.target.value as 'home' | 'office')} disabled={saving}>
                          {homeAddr?.line1 && String(homeAddr.line1).trim() !== '' && (
                            <option value="home">
                              {tt('checkout.address.home', 'Home — {line1}', { line1: homeAddr.line1 as any })}
                            </option>
                          )}
                          {officeAddr?.line1 && String(officeAddr.line1).trim() !== '' && (
                            <option value="office">
                              {tt('checkout.address.office', 'Office — {line1}', { line1: officeAddr.line1 as any })}
                            </option>
                          )}
                        </select>
                        {addressLabel && (
                          <div className="form-text">
                            {addressLabel === 'home' ? (
                              <>
                                {homeAddr?.city ? `${tt('checkout.address.city', 'City')}: ${homeAddr.city}. ` : ''}
                                {homeAddr?.zip ? `${tt('checkout.address.zip', 'ZIP')}: ${homeAddr.zip}. ` : ''}
                                {homeAddr?.notes ? `${tt('checkout.address.notes', 'Notes')}: ${homeAddr.notes}.` : ''}
                              </>
                            ) : (
                              <>
                                {officeAddr?.city ? `${tt('checkout.address.city', 'City')}: ${officeAddr.city}. ` : ''}
                                {officeAddr?.zip ? `${tt('checkout.address.zip', 'ZIP')}: ${officeAddr.zip}. ` : ''}
                                {officeAddr?.notes ? `${tt('checkout.address.notes', 'Notes')}: ${officeAddr.notes}.` : ''}
                              </>
                            )}
                          </div>
                        )}
                      </>
                    ) : (
                      <input className="form-control" value={address} onChange={(e) => setAddress(e.target.value)} placeholder={tt('checkout.address.inputPh', 'Ex. 5a avenida 10-11...')} disabled={saving} />
                    )}
                  </div>

                  <div className="mb-3">
                    <label className="form-label">{tt('checkout.phone.label', 'Phone')}</label>
                    <input className="form-control" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={tt('checkout.phone.ph', 'Ex. 5555-5555')} disabled={saving} />
                  </div>

                  <div className="mb-3">
                    <label className="form-label">{tt('checkout.deliveryOptions.label', 'Delivery options')}</label>
                    {deliveryOptions.length === 0 ? (
                      <div className="form-text">{tt('checkout.deliveryOptions.none', 'No shipping options available.')}</div>
                    ) : (
                      <div className="d-flex flex-column gap-2">
                        {deliveryOptions.map((opt) => (
                          <label key={opt.id} className="border rounded p-2 d-flex align-items-start gap-2">
                            <input type="radio" name="delivery-opt" className="form-check-input mt-1" checked={selectedDeliveryOptionId === opt.id} onChange={() => setSelectedDeliveryOptionId(opt.id)} disabled={saving} />
                            <div className="w-100">
                              <div className="d-flex justify-content-between">
                                <div className="fw-semibold">{opt.title}</div>
                                <div className="fw-semibold">{fmtQ(opt.price)}</div>
                              </div>
                              {opt.description && <div className="text-muted small">{opt.description}</div>}
                            </div>
                          </label>
                        ))}
                      </div>
                    )}
                  </div>

                  <div className="mb-3">
                    <label className="form-label">{tt('checkout.notes.label', 'Notes (optional)')}</label>
                    <textarea className="form-control" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={tt('checkout.notes.ph', 'Additional instructions')} disabled={saving} />
                  </div>
                </>
              )}

              {mode === 'pickup' && (
                <>
                  <div className="mb-3">
                    <label className="form-label">{tt('checkout.phone.label', 'Phone')}</label>
                    <input className="form-control" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder={tt('checkout.phone.ph', 'Ex. 5555-5555')} disabled={saving} />
                  </div>
                  <div className="mb-3">
                    <label className="form-label">{tt('checkout.notes.label', 'Notes (optional)')}</label>
                    <textarea className="form-control" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={tt('checkout.notes.ph', 'Additional instructions')} disabled={saving} />
                  </div>
                </>
              )}

              {/* --- Código de promoción --- */}
              <div className="mb-3">
                <label className="form-label fw-semibold">{tt('checkout.promo.label', 'Promotion coupon')}</label>
                <div className="d-flex gap-2">
                  <input
                    className="form-control"
                    placeholder={tt('checkout.promo.ph', 'Ex. DESSERT10')}
                    value={promoCode}
                    onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                    disabled={promoApplying || saving}
                  />
                  {!promo ? (
                    <button className="btn btn-outline-primary" onClick={applyPromo} disabled={promoApplying || saving}>
                      {promoApplying ? tt('checkout.promo.applying', 'Applying...') : tt('checkout.promo.apply', 'Apply')}
                    </button>
                  ) : (
                    <button className="btn btn-outline-secondary" onClick={clearPromo} disabled={saving}>
                      {tt('checkout.promo.remove', 'Remove')}
                    </button>
                  )}
                </div>
                {promo && (
                  <div className="text-success small mt-1">✓ {tt('checkout.promo.applied', 'Coupon applied: {code}', { code: <strong>{promo.code}</strong> as any })}</div>
                )}
                {promoErrorText && (
                  <div className="text-danger small mt-1">{promoErrorText}</div>
                )}
              </div>

              {/* MÉTODO DE PAGO */}
              <div className="mb-3">
                <label className="form-label fw-semibold">{tt('checkout.payment.method', 'Payment Method')}</label>

                {paymentsLoading ? (
                  <div className="form-text">{tt('common.loading', 'Loading…')}</div>
                ) : (
                  <div className="d-flex flex-column gap-2">
                    {paymentsFlags.cash && (
                      <label className="d-flex align-items-center gap-2">
                        <input type="radio" name="pm" className="form-check-input" checked={payMethod==='cash'} onChange={() => setPayMethod('cash')} />
                        <span>{tt('checkout.payment.cash', 'Cash')}</span>
                      </label>
                    )}

                    {paymentsFlags.paypal && (
                      <label className="d-flex align-items-center gap-2">
                        <input type="radio" name="pm" className="form-check-input" checked={payMethod==='paypal'} onChange={() => setPayMethod('paypal')} />
                        <span>{tt('checkout.payment.paypal', 'PayPal')}</span>
                        {paypalActiveHint && <span className="small text-muted ms-2">{paypalActiveHint}</span>}
                      </label>
                    )}

                    {!paymentsFlags.cash && !paymentsFlags.paypal && (
                      <div className="alert alert-warning py-2 mb-0">
                        {tt('checkout.payment.none', 'No payment methods available.')}
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* PayPal Buttons */}
              {payMethod === 'paypal' && paymentsFlags.paypal && (
                <div className="mb-3">
                  <div id="paypal-buttons-container" />
                </div>
              )}
            </div>

            <div className="card-footer">
              <div className="d-flex justify-content-between align-items-center">
                <div className="text-muted small">{tt('checkout.submit.note', 'It will be charged according to the selected method.')}</div>
                <button
                  className="btn btn-primary"
                  disabled={disableSubmit}
                  onClick={() => {
                    if (payMethod === 'cash') return onSubmitCash();
                    if (payMethod === 'paypal') {
                      alert(tt('checkout.payment.paypal.useBtn', 'Use the PayPal button to continue.'));
                    }
                  }}
                >
                  {saving ? tt('checkout.submit.processing', 'Processing…') : (payMethod === 'cash' ? tt('checkout.submit.confirmCash', 'Confirm order') : tt('checkout.submit.payNow', 'Pay now'))}
                </button>
              </div>
            </div>
          </div>
        </div>

        {/* Resumen */}
        <div className="col-12 col-lg-5">
          <div className="card border-0 shadow-sm">
            <div className="card-header">
              <div className="fw-semibold">{tt('checkout.summary.title', 'Summary')}</div>
            </div>
            <div className="card-body">
              {mode === 'delivery' && (
                <div className="border rounded p-2 mb-3 bg-light">
                  <div className="small text-muted">{tt('checkout.summary.deliver.title', 'Deliver')}</div>
                  <div className="fw-semibold">
                    {addressLabel === 'home'
                      ? tt('checkout.summary.address.home', 'Home')
                      : addressLabel === 'office'
                      ? tt('checkout.summary.address.office', 'Office')
                      : tt('checkout.summary.address.address', 'Address')}
                    {': '}
                    {address || (addressLabel === 'home' ? homeAddr?.line1 : officeAddr?.line1) || '—'}
                  </div>
                  {(addressLabel && (addressLabel === 'home' ? homeAddr : officeAddr)) && (
                    <div className="small text-muted mt-1">
                      {addressLabel === 'home'
                        ? [
                            homeAddr?.city ? `${tt('checkout.address.city', 'City')}: ${homeAddr.city}` : null,
                            homeAddr?.country ? `${tt('checkout.address.country', 'Country')}: ${homeAddr.country}` : null,
                            homeAddr?.zip ? `${tt('checkout.address.zip', 'ZIP')}: ${homeAddr.zip}` : null,
                          ].filter(Boolean).join(' · ')
                        : [
                            officeAddr?.city ? `${tt('checkout.address.city', 'City')}: ${officeAddr.city}` : null,
                            officeAddr?.country ? `${tt('checkout.address.country', 'Country')}: ${officeAddr.country}` : null,
                            officeAddr?.zip ? `${tt('checkout.address.zip', 'ZIP')}: ${officeAddr.zip}` : null,
                          ].filter(Boolean).join(' · ')
                      }
                    </div>
                  )}
                  <div className="mt-2 small">
                    <span className="text-muted">{tt('checkout.summary.client', 'Client:')}</span> {customerName || '—'}
                    <span className="text-muted ms-2">{tt('checkout.summary.phone', 'Phone:')}</span> {phone || '—'}
                  </div>
                </div>
              )}

              <div className="d-flex flex-column gap-3 mb-3">
                {cart.items.map((ln: any, idx: number) => {
                  const unitExtras = cart.computeLineTotal({ ...ln, quantity: 1 }) - ln.basePrice;
                  const lineSum = cart.computeLineTotal(ln);
                  return (
                    <div key={`${ln.menuItemId}-${idx}`} className="border rounded p-2">
                      <div className="d-flex justify-content-between">
                        <div className="fw-semibold">
                          {ln.menuItemName} <span className="text-muted">× {ln.quantity}</span>
                        </div>
                        <div className="fw-semibold">{fmtQ(lineSum)}</div>
                      </div>
                      {(ln.addons.length > 0 || ln.optionGroups.some((g: any) => g.items.length > 0)) && (
                        <div className="mt-2">
                          {ln.addons.map((ad: any, i: number) => (
                            <div className="d-flex justify-content-between small" key={`ad-${idx}-${i}`}>
                              <div>{tt('checkout.cart.addon.prefix', '— (addons) {name}', { name: ad.name })}</div>
                              <div>{fmtQ(ad.price)}</div>
                            </div>
                          ))}
                          {ln.optionGroups.map((g: any) =>
                            g.items.map((it: any) => (
                              <div
                                className="d-flex justify-content-between small"
                                key={`gi-${idx}-${g.groupId}-${it.id}`}
                              >
                                <div>— {it.name}</div>
                                <div>{fmtQ(it.priceDelta)}</div>
                              </div>
                            ))
                          )}
                        </div>
                      )}
                      <div className="text-muted small mt-1">
                        {tt('checkout.cart.each', '({price} each)', { price: fmtQ(ln.basePrice + unitExtras) })}
                      </div>
                    </div>
                  );
                })}
              </div>
              
              <div className="mt-3">
                <div className="d-flex justify-content-between">
                  <div>{tt('checkout.totals.subtotal', 'Subtotal')}</div>
                  <div className="fw-semibold">{fmtQ(subtotal)}</div>
                </div>

                {promo && (
                  <div className="d-flex justify-content-between text-success">
                    <div>{tt('checkout.totals.discount', 'Discount ({code})', { code: promo.code })}</div>
                    <div className="fw-semibold">- {fmtQ((promo.discountTotalCents||0)/100)}</div>
                  </div>
                )}

                {mode === 'delivery' && (
                  <div className="d-flex justify-content-between">
                    <div>{tt('checkout.totals.delivery', 'Delivery')}</div>
                    <div className="fw-semibold">{fmtQ(deliveryFee)}</div>
                  </div>
                )}

                {!!taxUI && !taxUI.pricesIncludeTax && taxUI.taxQ > 0 && (
                  <div className="d-flex justify-content-between">
                    <div>{tt('checkout.totals.tax', 'Tax')}</div>
                    <div className="fw-semibold">{fmtQ(taxUI?.taxQ || 0)}</div>
                  </div>
                )}

                {mode !== 'delivery' && (
                  <div className="d-flex align-items-center justify-content-between gap-2 mt-2">
                    <label className="mb-0">{tt('checkout.totals.tip.label', 'Tip (suggested 10%)')}</label>
                    <div className="d-flex align-items-center gap-2">
                      <input type="number" min="0" step="0.01" className="form-control form-control-sm" style={{ width: 120 }}
                        value={Number.isFinite(tip) ? tip : 0}
                        onChange={(e) => { setTipEdited(true); const v = Number(e.target.value); setTip(Number.isFinite(v) ? v : 0); }} />
                      <span className="text-muted small">{fmtQ(tip)}</span>
                    </div>
                  </div>
                )}
                <hr />
                <div className="d-flex justify-content-between">
                  <div className="fw-semibold">{tt('checkout.totals.grand', 'Grand total')}</div>
                  <div className="fw-bold">{fmtQ(grandToShow)}</div>
                </div>
              </div>
            </div>
            <div className="card-footer d-flex justify-content-between">
              <div className="small text-muted">
                {tt('checkout.footer.totalNote', 'Total according to selected method{suffix}.', {
                  suffix: promo ? tt('checkout.footer.includesPromo', ' (includes {code})', { code: promo.code }) : ''
                })}
              </div>
              <div />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** ------- Variante (efectivo + PayPal) ------- */
function CheckoutCoreNoStripe() {
  const { state, actions, helpers } = useCheckoutState();
  const { cart, db, router, buildOrderPayload, withTenant, tenantId } = helpers;
  const { tt } = useLangTT();

  const { flags: corePayFlags, loading: pfLoading } = usePaymentProfile();
  const enabledPaypal = corePayFlags.paypal && !pfLoading;

  // Efectivo (Firestore namespaced + navegación tenant)
// Pon este helper en el archivo (arriba, donde definiste el otro helper)
async function userHasTenantClaim(u: any, tenantId: string) {
  const tok = await u.getIdTokenResult(true);
  const t = (tok?.claims as any)?.tenants || {};
  return !!t[tenantId];
}

// Reemplaza tu onSubmitCash completo por este:
const onSubmitCash = async () => {
  try {
    actions.setSaving(true);

    const auth = getAuth();
    const u = auth.currentUser;

    // (A) Debe existir sesión
    if (!u) {
      alert('Inicia sesión para crear la orden.');
      actions.setSaving(false);
      return;
    }

    // (B) Refrescar claims en tu backend (si aplica)
    try {
      const idToken = await u.getIdToken(true);
      const resp = await fetch(withTenant('/app/api/auth/refresh-role'), {
        method: 'POST',
        headers: { Authorization: `Bearer ${idToken}` },
        cache: 'no-store',
        credentials: 'same-origin',
      });
      if (resp?.ok) await u.getIdToken(true);
    } catch {}

    // (C) Construir payload igual que antes
    const payload = await buildOrderPayload();
    (payload as any).payment = {
      provider: 'cash',
      status: 'pending',
      amount: (payload as any).totals?.grandTotalWithTax ?? (payload as any).orderTotal,
      currency: (payload as any).totals?.currency || 'USD',
      createdAt: serverTimestamp(),
    };

    // (D) Tomar claims y hacer PRE-FLIGHT de las mismas condiciones que tus reglas
    const claims: any = await getClaims(u);
    const simpleTenantClaim = claims?.tenantId === tenantId; // tu regla lo acepta
    const mapTenantClaim = !!(claims?.tenants && claims?.tenants[tenantId!]); // tu regla también lo acepta

    const preflight = {
      tenantIdPropInPayload: (payload as any)?.tenantId === tenantId, // enforceTenantIdOnCreate
      createdByUidMatches: (payload as any)?.createdBy?.uid === u.uid, // createdBy.uid == auth.uid
      statusPlaced: (payload as any)?.status === 'placed',
      orderTypeAllowed: ['dine-in', 'delivery', 'pickup'].includes((payload as any)?.orderInfo?.type),
      // inTenant(tenantId) - cualquiera de los dos es válido según tus reglas
      inTenant_simple: simpleTenantClaim,
      inTenant_map: mapTenantClaim,
      // diagnóstico extra
      tenantIdResolved: tenantId,
      authUid: u.uid,
      email: u.email || null,
      claimsPreview: {
        tenantId: claims?.tenantId ?? null,
        tenantsKeys: claims?.tenants ? Object.keys(claims.tenants) : [],
        rolesAtTenant: claims?.tenants?.[tenantId!]?.roles || null,
      },
    };

    // Si algo crítico está mal, no intentes escribir y muestra diagnóstico claro
    if (!tenantId) {
      alert('Sin tenantId en el cliente. No se puede crear la orden.');
      console.warn('PRE-FLIGHT', preflight);
      actions.setSaving(false);
      return;
    }
    if (!preflight.inTenant_simple && !preflight.inTenant_map) {
      alert('Tu sesión no tiene claim para este tenant. (Mira la consola para más detalle)');
      console.warn('PRE-FLIGHT (sin inTenant)', preflight);
      actions.setSaving(false);
      return;
    }
    if (!preflight.tenantIdPropInPayload) {
      alert('El payload no incluye tenantId correcto.');
      console.warn('PRE-FLIGHT (tenantId mismatch)', preflight);
      actions.setSaving(false);
      return;
    }
    if (!preflight.createdByUidMatches || !preflight.statusPlaced || !preflight.orderTypeAllowed) {
      alert('El payload no cumple las condiciones de reglas (revisa consola).');
      console.warn('PRE-FLIGHT (payload mismatch reglas)', preflight, payload);
      actions.setSaving(false);
      return;
    }

    // (E) Si pasa el preflight, ahora sí escribe
    const ref = await addDoc(tCol('orders', tenantId!), { ...payload, tenantId });

    // (F) consumir promo como ya tenías
    if (state.promo?.promoId) {
      try {
        await fetch(withTenant('/app/api/promotions/consume'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-tenant': tenantId || '' },
          body: JSON.stringify({ promoId: state.promo.promoId, code: state.promo.code, orderId: ref.id }),
        });
      } catch {}
    }

    helpers.cart.clear();
    helpers.router.push(withTenant('/app/cart-new'));
    alert('Order created (cash) ✓');
  } catch (e: any) {
    console.error(e);
    alert('No se pudo crear la orden: ' + (e?.message || 'permiso denegado'));
  } finally {
    actions.setSaving(false);
  }
};


  // PayPal: carga SDK sólo si está habilitado
  const [paypalReady, setPaypalReady] = useState(false);
  const paypalButtonsRef = useRef<any>(null);

  useEffect(() => {
    if (!enabledPaypal) return;
    if (typeof window === 'undefined') return;
    const cid = process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID;
    if (!cid) return;
    if ((window as any).paypal) { setPaypalReady(true); return; }
    const s = document.createElement('script');
    const currency = process.env.NEXT_PUBLIC_PAY_CURRENCY || 'USD';
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(cid)}&currency=${encodeURIComponent(currency)}`;
    s.async = true;
    s.onload = () => setPaypalReady(true);
    s.onerror = () => console.warn('PayPal could not be loaded SDK.');
    document.body.appendChild(s);
  }, [enabledPaypal]);

  useEffect(() => {
    if (!tenantId) return;
    if (state.payMethod !== 'paypal') return;
    if (!enabledPaypal || !paypalReady) return;
    const paypal = (window as any).paypal;
    if (!paypal?.Buttons) return;

    let destroyed = false;
    const renderButtons = async () => {
      const el = document.getElementById('paypal-buttons-container');
      if (!el) return;

      if (paypalButtonsRef.current?.close) {
        try { await paypalButtonsRef.current.close(); } catch {}
        paypalButtonsRef.current = null;
      }

      const btns = paypal.Buttons({
        createOrder: async () => {
          const draft = await buildOrderPayload();
          const res = await fetch(withTenant('/app/api/pay/paypal/create-order'), {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'x-tenant': tenantId || '' },
            body: JSON.stringify({ orderDraft: draft }),
          });
          if (!res.ok) {
            const j = await res.json().catch(() => null);
            throw new Error(j?.error || 'Could not create PayPal order.');
          }
          const { paypalOrderId } = await res.json();
          return paypalOrderId;
        },
        onApprove: async (data: any) => {
          try {
            const res = await fetch(withTenant('/app/api/pay/paypal/capture'), {
              method: 'POST',
              headers: { 'Content-Type': 'application/json', 'x-tenant': tenantId || '' },
              body: JSON.stringify({ paypalOrderId: data.orderID }),
            });
            if (!res.ok) {
              const j = await res.json().catch(() => null);
              throw new Error(j?.error || 'Could not capture PayPal.');
            }

            let captured: any = null;
            try { captured = await res.json(); } catch {}
            const orderId = captured?.orderId;

            if (state.promo?.promoId && orderId) {
              try {
                await fetch(withTenant('/app/api/promotions/consume'), {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json', 'x-tenant': tenantId || '' },
                  body: JSON.stringify({ promoId: state.promo.promoId, code: state.promo.code, orderId }),
                });
              } catch {}
            }

            if (paypalButtonsRef.current?.close) {
              try { await paypalButtonsRef.current.close(); } catch {}
              paypalButtonsRef.current = null;
            }

            cart.clear();
            router.push(withTenant('/app/cart-new'));
            alert(tt('checkout.alert.paypalCaptured', 'PayPal payment captured. Order Confirmed'));
          } catch (e: any) {
            alert(e?.message || tt('checkout.alert.paypalCaptureError', 'Error capturing PayPal.'));
          }
        },
        onError: (err: any) => {
          console.error('PayPal error:', err);
          alert(tt('checkout.alert.paypalError', 'Error in PayPal.'));
        },
        style: { layout: 'vertical', shape: 'rect', label: 'paypal' },
      });

      if (!destroyed) {
        paypalButtonsRef.current = btns;
        await btns.render('#paypal-buttons-container');
      }
    };

    renderButtons();
    return () => {
      destroyed = true;
      if (paypalButtonsRef.current?.close) {
        try { paypalButtonsRef.current.close(); } catch {}
        paypalButtonsRef.current = null;
      }
    };
  }, [state.payMethod, paypalReady, buildOrderPayload, state.promo, enabledPaypal, cart, router, withTenant, tenantId]);

  return (
    <CheckoutUI
      state={state}
      actions={actions}
      onSubmitCash={onSubmitCash}
      paypalActiveHint={!process.env.NEXT_PUBLIC_PAYPAL_CLIENT_ID ? '(Configura NEXT_PUBLIC_PAYPAL_CLIENT_ID)' : undefined}
      cart={cart}
    />
  );
}

/** ------- Export por defecto ------- */
export default function CheckoutCardsPage() {
  const { tt, ready } = useLangTT();
if (!ready) return <div className="container py-4">Loading…</div>;

  
  return (
    <Suspense fallback={<div className="container py-4">{tt('common.loading', 'Loading…')}</div>}>
      <CheckoutCoreNoStripe />
    </Suspense>
  );
}
