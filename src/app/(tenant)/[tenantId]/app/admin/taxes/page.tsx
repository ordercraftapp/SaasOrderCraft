// src/app/(tenant)/[tenantId]/app/admin/taxes/page.tsx 
'use client';

import { useEffect, useMemo, useState } from 'react';
import Protected from '@/app/(tenant)/[tenantId]/components/Protected';
import AdminOnly from '@/app/(tenant)/[tenantId]/components/AdminOnly';
import ToolGate from '@/components/ToolGate';
import '@/lib/firebase/client';
import { useTenantId } from '@/lib/tenant/context';

// 🔤 i18n (igual que kitchen)
import { t as translate } from '@/lib/i18n/t';
import { useTenantSettings } from '@/lib/settings/hooks';

import {
  // getActiveTaxProfile,  // ⛔️ reemplazado por lectura scoped al tenant (misma lógica)
  type TaxProfile,
  type TaxRateRule,
  type OrderType,
  type JurisdictionRule,
} from '@/lib/tax/profile';

import {
  getFirestore,
  collection,
  getDocs,
  doc,
  getDoc,
  deleteDoc,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore';

type RoundingMode = 'half_up' | 'half_even';
const ORDER_TYPES: OrderType[] = ['dine-in', 'delivery', 'pickup'];

function csvToArray(s?: string) {
  return (s || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
}
function arrayToCsv(arr?: string[]) {
  return (arr || []).join(', ');
}

/** 🔧 Clean recursively: remove `undefined` and compact arrays/objects */
function deepStripUndefined<T>(value: T): T {
  if (Array.isArray(value)) {
    const arr = value
      .map((v) => deepStripUndefined(v))
      .filter((v) => v !== undefined) as any[];
    return arr as any;
  }
  if (value !== null && typeof value === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(value as any)) {
      if (v === undefined) continue;
      const cleaned = deepStripUndefined(v as any);
      if (cleaned !== undefined) out[k] = cleaned;
    }
    return out;
  }
  return value;
}

/** Normalize payload for Firestore: drop `id`, clean up and set `active: true` */
function normalizeProfileForFirestore(form: TaxProfile) {
  const { id: _drop, ...rest } = form as any;
  const cleaned = deepStripUndefined({
    ...rest,
    active: true,
  });
  return cleaned;
}

/** 💵 Money formatter from cents using Intl */
function fmtMoneyCents(vCents: number, currency = 'USD') {
  const n = (Number.isFinite(vCents) ? Number(vCents) : 0) / 100;
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}

export default function AdminTaxesPage() {
  const tenantId = useTenantId();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // 🔤 obtener idioma como en kitchen
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

  // Editor state (profile being edited)
  const [form, setForm] = useState<TaxProfile>({
    country: 'GT',
    currency: 'USD',
    pricesIncludeTax: true,
    rounding: 'half_up',
    // Nota: estos labels son datos; usamos fallback en inglés por consistencia
    rates: [{ code: 'std', label: tt('admin.taxes.stdVat', 'Standard VAT'), rateBps: 1200, appliesTo: 'all' }],
    surcharges: [{ code: 'service', label: tt('admin.taxes.serviceCharge', 'Service charge'), percentBps: 0, taxable: false }],
    delivery: { mode: 'out_of_scope', taxable: false },
  });

  // Profiles list
  const [profiles, setProfiles] = useState<
    Array<{ id: string; data: any; active?: boolean }>
  >([]);

  // ===== Helpers SCOPED por tenant =====
  async function getActiveTaxProfileScoped(tid: string): Promise<TaxProfile | null> {
    const db = getFirestore();
    const activeRef = doc(db, `tenants/${tid}/taxProfiles/active`);
    const snap = await getDoc(activeRef);
    if (!snap.exists()) return null;
    const raw: any = snap.data();

    const profile: TaxProfile = {
      id: 'active',
      country: String(raw.country || 'GT'),
      currency: String(raw.currency || 'USD'),
      pricesIncludeTax: Boolean(raw.pricesIncludeTax ?? true),
      rounding: raw.rounding === 'half_even' ? 'half_even' : 'half_up',
      rates: Array.isArray(raw.rates) && raw.rates.length
        ? raw.rates
        : [{ code: 'std', label: tt('admin.taxes.stdVat', 'Standard VAT'), rateBps: 1200, appliesTo: 'all' }],
      surcharges: Array.isArray(raw.surcharges) && raw.surcharges.length
        ? raw.surcharges
        : [{ code: 'service', label: tt('admin.taxes.serviceCharge', 'Service charge'), percentBps: 0, taxable: false }],
      delivery: raw.delivery
        ? {
            mode: raw.delivery.mode === 'as_line' ? 'as_line' : 'out_of_scope',
            taxable: Boolean(raw.delivery.taxable ?? false),
            taxCode: raw.delivery.taxCode ? String(raw.delivery.taxCode) : undefined,
          }
        : { mode: 'out_of_scope', taxable: false },
      jurisdictions: Array.isArray(raw.jurisdictions) ? raw.jurisdictions : undefined,
      b2bConfig: raw.b2bConfig || undefined,
    };
    return profile;
  }

  async function fetchProfilesList(tid: string) {
    const db = getFirestore();
    const snap = await getDocs(collection(db, `tenants/${tid}/taxProfiles`));
    // active first
    const rows = snap.docs.map((d) => ({
      id: d.id,
      data: d.data(),
      active: d.id === 'active' || !!(d.data() as any)?.active,
    }));
    return rows.sort((a, b) => (a.active === b.active ? 0 : a.active ? -1 : 1));
  }

  // Load active profile + list
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        if (!tenantId) return;
        const [active, list] = await Promise.all([
          getActiveTaxProfileScoped(tenantId),
          fetchProfilesList(tenantId),
        ]);
        if (active) {
          setForm((prev) => ({
            ...prev,
            ...active,
            rates: Array.isArray(active.rates) && active.rates.length
              ? active.rates
              : [{ code: 'std', label: tt('admin.taxes.stdVat', 'Standard VAT'), rateBps: 1200, appliesTo: 'all' }],
            surcharges: Array.isArray(active.surcharges) && active.surcharges.length
              ? active.surcharges
              : [{ code: 'service', label: tt('admin.taxes.serviceCharge', 'Service charge'), percentBps: 0, taxable: false }],
            delivery: active.delivery ?? { mode: 'out_of_scope', taxable: false },
          }));
        }
        setProfiles(list);
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId]);

  // Load a profile by id into the editor
  async function loadProfileIntoEditor(id: string) {
    try {
      if (!tenantId) return alert(tt('admin.common.missingTenant', 'Missing tenant context.'));
      const db = getFirestore();
      const snap = await getDoc(doc(db, `tenants/${tenantId}/taxProfiles`, id));
      if (!snap.exists()) return alert(tt('admin.taxes.err.profileNotFound', 'Profile not found.'));
      const raw: any = snap.data();

      // Map to TaxProfile (similar to getActiveTaxProfile)
      const toRates = Array.isArray(raw.rates)
        ? raw.rates.map((r: any) => ({
            code: String(r.code),
            label: r.label ? String(r.label) : undefined,
            rateBps: Number(r.rateBps || 0),
            appliesTo: r.appliesTo === 'all' ? 'all' : undefined,
            itemCategoryIn: Array.isArray(r.itemCategoryIn) ? r.itemCategoryIn.map(String) : undefined,
            itemTagIn: Array.isArray(r.itemTagIn) ? r.itemTagIn.map(String) : undefined,
            excludeItemTagIn: Array.isArray(r.excludeItemTagIn) ? r.excludeItemTagIn.map(String) : undefined,
            orderTypeIn: Array.isArray(r.orderTypeIn) ? (r.orderTypeIn as OrderType[]) : undefined,
          }))
        : [];

      const toSurch = Array.isArray(raw.surcharges)
        ? raw.surcharges.map((s: any) => ({
            code: String(s.code),
            label: s.label ? String(s.label) : undefined,
            percentBps: Number(s.percentBps || 0),
            applyWhenOrderTypeIn: Array.isArray(s.applyWhenOrderTypeIn) ? (s.applyWhenOrderTypeIn as OrderType[]) : undefined,
            taxable: Boolean(s.taxable ?? false),
            taxCode: s.taxCode ? String(s.taxCode) : undefined,
          }))
        : [];

      const profile: TaxProfile = {
        id: snap.id,
        country: String(raw.country || 'GT'),
        currency: String(raw.currency || 'USD'),
        pricesIncludeTax: Boolean(raw.pricesIncludeTax ?? true),
        rounding: raw.rounding === 'half_even' ? 'half_even' : 'half_up',
        rates: toRates.length ? toRates : [{ code: 'std', label: tt('admin.taxes.stdVat', 'Standard VAT'), rateBps: 1200, appliesTo: 'all' }],
        surcharges: toSurch.length ? toSurch : [{ code: 'service', label: tt('admin.taxes.serviceCharge', 'Service charge'), percentBps: 0, taxable: false }],
        delivery: raw.delivery
          ? {
              mode: raw.delivery.mode === 'as_line' ? 'as_line' : 'out_of_scope',
              taxable: Boolean(raw.delivery.taxable ?? false),
              taxCode: raw.delivery.taxCode ? String(raw.delivery.taxCode) : undefined,
            }
          : { mode: 'out_of_scope', taxable: false },
        jurisdictions: Array.isArray(raw.jurisdictions) ? raw.jurisdictions : undefined,
        b2bConfig: raw.b2bConfig || undefined,
      };
      setForm(profile);
      alert(tt('admin.taxes.msg.loadedProfile', 'Loaded profile "{id}" into the editor. Remember to Save to set it active.', { id: snap.id }));
    } catch (e: any) {
      alert(e?.message || tt('admin.taxes.err.load', 'Could not load profile.'));
    }
  }

  // Mark as ACTIVE by copying selected doc to tenants/{tenantId}/taxProfiles/active
  async function setActiveProfile(id: string) {
    try {
      if (!tenantId) return alert(tt('admin.common.missingTenant', 'Missing tenant context.'));
      const db = getFirestore();
      const snap = await getDoc(doc(db, `tenants/${tenantId}/taxProfiles`, id));
      if (!snap.exists()) return alert(tt('admin.taxes.err.profileNotFound', 'Profile not found.'));
      const raw = snap.data() as any;

      const payload = normalizeProfileForFirestore({
        ...(raw as TaxProfile),
        // ensure minimal defaults
        country: String((raw as any).country || 'GT'),
        currency: String((raw as any).currency || 'USD'),
        pricesIncludeTax: Boolean((raw as any).pricesIncludeTax ?? true),
        rounding: (raw as any).rounding === 'half_even' ? 'half_even' : 'half_up',
      } as TaxProfile);

      const dbRef = doc(getFirestore(), `tenants/${tenantId}/taxProfiles`, 'active');
      await setDoc(dbRef, { ...payload, tenantId, updatedAt: serverTimestamp(), createdAt: serverTimestamp() }, { merge: false });

      // refresh list + editor (load active)
      const [active, list] = await Promise.all([getActiveTaxProfileScoped(tenantId), fetchProfilesList(tenantId)]);
      if (active) setForm(active);
      setProfiles(list);
      alert(tt('admin.taxes.msg.nowActive', '"{id}" is now active.', { id }));
    } catch (e: any) {
      alert(e?.message || tt('admin.taxes.err.setActive', 'Could not set active.'));
    }
  }

  // Delete (block if active)
  async function removeProfile(id: string, isActive?: boolean) {
    if (isActive || id === 'active') {
      return alert(tt('admin.taxes.err.cannotDeleteActive', 'You cannot delete the active profile. Set another profile active first.'));
    }
    const ok = confirm(tt('admin.taxes.ask.delete', 'Delete profile "{id}"? This cannot be undone.', { id }));
    if (!ok) return;
    try {
      if (!tenantId) return alert(tt('admin.common.missingTenant', 'Missing tenant context.'));
      const db = getFirestore();
      await deleteDoc(doc(db, `tenants/${tenantId}/taxProfiles`, id));
      setProfiles(await fetchProfilesList(tenantId));
      alert(tt('admin.taxes.msg.deleted', 'Profile deleted.'));
    } catch (e: any) {
      alert(e?.message || tt('admin.taxes.err.delete', 'Could not delete.'));
    }
  }

  const onChange = <K extends keyof TaxProfile>(key: K, value: TaxProfile[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }));
  };

  // Service Charge helpers (use first surcharge)
  const service = form.surcharges?.[0];
  const setService = (patch: Partial<NonNullable<TaxProfile['surcharges']>[number]>) => {
    const next = [...(form.surcharges || [])];
    if (!next[0]) next[0] = { code: 'service', label: tt('admin.taxes.serviceCharge', 'Service charge'), percentBps: 0, taxable: false };
    next[0] = { ...next[0], ...patch };
    onChange('surcharges', next);
  };

  // ➕ B2B helper
  const setB2B = (patch: any) => {
    onChange('b2bConfig', { ...(form.b2bConfig || {}), ...patch });
  };

  // Save editor → write active doc (clean) in tenants/{tenantId}/taxProfiles/active
  const save = async () => {
    setSaving(true);
    try {
      if (!tenantId) throw new Error(tt('admin.common.missingTenant', 'Missing tenant context.'));
      const payload = normalizeProfileForFirestore({
        ...form,
        country: String(form.country || 'GT'),
        currency: String(form.currency || 'USD'),
        pricesIncludeTax: !!form.pricesIncludeTax,
        rounding: (form.rounding === 'half_even' ? 'half_even' : 'half_up'),
      } as TaxProfile);

      const db = getFirestore();
      await setDoc(
        doc(db, `tenants/${tenantId}/taxProfiles`, 'active'),
        { ...payload, tenantId, updatedAt: serverTimestamp(), createdAt: serverTimestamp() },
        { merge: false }
      );

      setProfiles(await fetchProfilesList(tenantId));
      alert(tt('admin.taxes.msg.saved', 'Tax profile saved (and set active).'));
    } catch (e: any) {
      alert(e?.message || tt('admin.taxes.err.save', 'Could not save.'));
    } finally {
      setSaving(false);
    }
  };

  const rateCodes = useMemo(() => (form.rates || []).map((r) => r.code), [form.rates]);

  if (loading) {
    return (
      <Protected>
        <AdminOnly>
          <ToolGate feature="taxes">
            <main className="container py-4">
              <div className="d-flex align-items-center justify-content-between mb-3">
                <h1 className="h3 m-0">{tt('admin.taxes.title', 'Taxes')}</h1>
                <span className="spinner-border spinner-border-sm text-secondary" role="status" aria-hidden="true"></span>
              </div>
              <p className="text-muted">{tt('common.loading', 'Loading…')}</p>
            </main>
          </ToolGate>
        </AdminOnly>
      </Protected>
    );
  }

  return (
    <Protected>
      <AdminOnly>
        <ToolGate feature="taxes">
          <main className="container py-4">
            {/* Top toolbar */}
            <div className="d-flex align-items-center justify-content-between mb-3 sticky-top bg-body pt-2 pb-2" style={{ zIndex: 1 }}>
              <div>
                <h1 className="h3 m-0">{tt('admin.taxes.title', 'Taxes')}</h1>
                <div className="text-muted small">
                  {tt('admin.taxes.subtitle', 'Configure VAT/GST, service charges, delivery and B2B options.')}
                </div>
              </div>
              <button disabled={saving} className="btn btn-primary shadow-sm" onClick={save}>
                {saving ? tt('common.saving', 'Saving…') : tt('admin.taxes.actions.saveProfile', 'Save profile')}
              </button>
            </div>

            <div className="row g-3">
              {/* Main column */}
              <div className="col-12 col-lg-8">
                {/* Basics */}
                <div className="card shadow-sm mb-3">
                  <div className="card-header"><strong>{tt('admin.taxes.basic.title', 'Basic settings')}</strong></div>
                  <div className="card-body">
                    <div className="row">
                      <div className="col-md-3 mb-3">
                        <label className="form-label">{tt('admin.taxes.basic.country', 'Country')}</label>
                        <input
                          className="form-control"
                          value={form.country || ''}
                          onChange={(e) => onChange('country', e.target.value)}
                        />
                      </div>
                      <div className="col-md-3 mb-3">
                        <label className="form-label">{tt('admin.taxes.basic.currency', 'Currency')}</label>
                        <input
                          className="form-control"
                          value={form.currency || ''}
                          onChange={(e) => onChange('currency', e.target.value)}
                        />
                      </div>
                      <div className="col-md-3 mb-3">
                        <label className="form-label">{tt('admin.taxes.basic.include', 'Prices include tax?')}</label>
                        <div className="form-check form-switch">
                          <input
                            type="checkbox"
                            className="form-check-input"
                            checked={!!form.pricesIncludeTax}
                            onChange={(e) => onChange('pricesIncludeTax', e.target.checked)}
                          />
                        </div>
                        <div className="form-text">
                          {tt('admin.taxes.basic.includeHint', 'Inclusive: tax is already included in the listed price.')}
                        </div>
                      </div>
                      <div className="col-md-3 mb-3">
                        <label className="form-label">{tt('admin.taxes.basic.rounding', 'Rounding')}</label>
                        <select
                          className="form-select"
                          value={(form.rounding || 'half_up') as RoundingMode}
                          onChange={(e) => onChange('rounding', e.target.value as RoundingMode)}
                        >
                          <option value="half_up">{tt('admin.taxes.rounding.halfUp', 'Half up (5 rounds up)')}</option>
                          <option value="half_even">{tt('admin.taxes.rounding.halfEven', 'Half even (banker’s rounding)')}</option>
                        </select>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Rates editor */}
                <RatesEditor
                  rates={form.rates || []}
                  onChange={(next) => onChange('rates', next)}
                  pricesIncludeTax={!!form.pricesIncludeTax}
                  tt={tt}
                />

                {/* Service charge */}
                <div className="card shadow-sm mb-3">
                  <div className="card-header"><strong>{tt('admin.taxes.service.title', 'Service charge')}</strong></div>
                  <div className="card-body">
                    <div className="row">
                      <div className="col-md-4 mb-3">
                        <label className="form-label">{tt('common.enabled', 'Enabled')}</label>
                        <div className="form-check form-switch">
                          <input
                            className="form-check-input"
                            type="checkbox"
                            checked={!!(service && service.percentBps && service.percentBps > 0)}
                            onChange={(e) => {
                              const enabled = e.target.checked;
                              setService({ percentBps: enabled ? (service?.percentBps || 1000) : 0 });
                            }}
                          />
                        </div>
                      </div>
                      <div className="col-md-4 mb-3">
                        <label className="form-label">{tt('admin.taxes.service.rate', 'Rate (%)')}</label>
                        <div className="input-group">
                          <input
                            type="number"
                            min={0}
                            step="0.01"
                            className="form-control"
                            value={((service?.percentBps || 0) / 100).toString()}
                            onChange={(e) => setService({ percentBps: Math.round(parseFloat(e.target.value || '0') * 100) })}
                          />
                          <span className="input-group-text">%</span>
                        </div>
                      </div>
                      <div className="col-md-4 mb-3">
                        <label className="form-label">{tt('admin.taxes.service.taxable', 'Taxable?')}</label>
                        <div className="form-check form-switch">
                          <input
                            className="form-check-input"
                            type="checkbox"
                            checked={!!service?.taxable}
                            onChange={(e) => setService({ taxable: e.target.checked })}
                          />
                        </div>
                        {service?.taxable && (
                          <div className="mt-2">
                            <label className="form-label">{tt('admin.taxes.service.taxCode', 'Tax code')}</label>
                            <select
                              className="form-select"
                              value={service?.taxCode || ''}
                              onChange={(e) => setService({ taxCode: e.target.value || undefined })}
                            >
                              <option value="">{tt('common.choose', '(choose)')}</option>
                              {(form.rates || []).map((r) => (
                                <option key={r.code} value={r.code}>{r.code}</option>
                              ))}
                            </select>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="form-text">
                      {tt('admin.taxes.service.hint', 'If “Taxable” is enabled, tax will be calculated on the charge using the selected')} <i>{tt('admin.taxes.service.taxCode', 'Tax code')}</i>.
                    </div>
                  </div>
                </div>

                {/* Delivery policy */}
                <div className="card shadow-sm mb-3">
                  <div className="card-header"><strong>{tt('admin.taxes.delivery.title', 'Delivery fee policy')}</strong></div>
                  <div className="card-body">
                    <div className="row">
                      <div className="col-md-4 mb-3">
                        <label className="form-label">{tt('admin.taxes.delivery.mode', 'Mode')}</label>
                        <select
                          className="form-select"
                          value={form.delivery?.mode || 'out_of_scope'}
                          onChange={(e) =>
                            onChange('delivery', {
                              ...(form.delivery || { mode: 'out_of_scope' }),
                              mode: e.target.value as 'as_line' | 'out_of_scope',
                            })
                          }
                        >
                          <option value="out_of_scope">{tt('admin.taxes.delivery.outOfScope', 'Out of scope (outside the engine)')}</option>
                          <option value="as_line">{tt('admin.taxes.delivery.asLine', 'As line (synthetic line)')}</option>
                        </select>
                      </div>
                      <div className="col-md-4 mb-3">
                        <label className="form-label">{tt('admin.taxes.delivery.taxable', 'Taxable?')}</label>
                        <div className="form-check form-switch">
                          <input
                            className="form-check-input"
                            type="checkbox"
                            checked={!!form.delivery?.taxable}
                            onChange={(e) =>
                              onChange('delivery', {
                                ...(form.delivery || { mode: 'out_of_scope' }),
                                taxable: e.target.checked,
                              })
                            }
                          />
                        </div>
                      </div>
                      <div className="col-md-4 mb-3">
                        <label className="form-label">{tt('admin.taxes.delivery.taxCodeIf', 'Tax code (if taxable)')}</label>
                        <select
                          className="form-select"
                          value={form.delivery?.taxCode || ''}
                          onChange={(e) =>
                            onChange('delivery', {
                              ...(form.delivery || { mode: 'out_of_scope' }),
                              taxCode: e.target.value || undefined,
                            })
                          }
                          disabled={!form.delivery?.taxable}
                        >
                          <option value="">{tt('common.choose', '(choose)')}</option>
                          {(form.rates || []).map((r) => (
                            <option key={r.code} value={r.code}>{r.code}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                    <div className="form-text">
                      {tt('admin.taxes.delivery.hint', 'With “As line”, the engine adds a synthetic “delivery” line and, if taxable, applies the selected code.')}
                    </div>
                  </div>
                </div>

                {/* Jurisdictions (read-only quick view) */}
                <div className="card shadow-sm mb-3">
                  <div className="card-header"><strong>{tt('admin.taxes.jur.quickTitle', 'Jurisdictions (read-only quick view)')}</strong></div>
                  <div className="card-body">
                    {Array.isArray(form.jurisdictions) && form.jurisdictions.length > 0 ? (
                      <div className="d-flex flex-column gap-2">
                        {form.jurisdictions.map((j: any, i: number) => {
                          const m = j?.match || {};
                          const tags: string[] = [];
                          if (m.country) tags.push(`${tt('admin.taxes.jur.country', 'country')}=${m.country}`);
                          if ((m as any).state) tags.push(`${tt('admin.taxes.jur.state', 'state')}=${(m as any).state}`);
                          if (m.city) tags.push(`${tt('admin.taxes.jur.city', 'city')}=${m.city}`);
                          if (m.zipPrefix) tags.push(`${tt('admin.taxes.jur.zipPrefix', 'zipPrefix')}^=${m.zipPrefix}`);
                          const counts: string[] = [];
                          if (Array.isArray(j.ratesOverride)) counts.push(`${tt('admin.taxes.jur.rates', 'rates')}: ${j.ratesOverride.length}`);
                          if (Array.isArray(j.surchargesOverride)) counts.push(`${tt('admin.taxes.jur.surcharges', 'surcharges')}: ${j.surchargesOverride.length}`);
                          if (j.deliveryOverride) counts.push(`${tt('admin.taxes.jur.delivery', 'delivery')}: 1`);
                          return (
                            <div className="border rounded p-2" key={i}>
                              <div className="d-flex justify-content-between">
                                <div><strong>{j.code || `jur-${i+1}`}</strong></div>
                                <div className="text-muted small">{counts.join(' · ') || tt('admin.taxes.jur.noOverrides', 'no overrides')}</div>
                              </div>
                              <div className="text-muted small">{tt('admin.taxes.jur.match', 'match')}: {tags.join(', ') || '—'}</div>
                              {j.pricesIncludeTaxOverride !== undefined && (
                                <div className="text-muted small">pricesIncludeTax: {String(j.pricesIncludeTaxOverride)}</div>
                              )}
                              {j.roundingOverride && (
                                <div className="text-muted small">rounding: {j.roundingOverride}</div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (
                      <div className="text-muted">
                        <div>{tt('admin.taxes.jur.none', 'No jurisdiction overrides configured.')}</div>
                        <div className="small"></div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Jurisdictions (editor) */}
                <JurisdictionsEditor
                  jurisdictions={form.jurisdictions || []}
                  onChange={(next) => onChange('jurisdictions', next)}
                  rateCodes={rateCodes}
                  tt={tt}
                />

                {/* B2B / Invoice numbering */}
                <div className="card shadow-sm mb-3">
                  <div className="card-header"><strong>{tt('admin.taxes.b2b.title', 'B2B / Invoice numbering')}</strong></div>
                  <div className="card-body">
                    <div className="row">
                      <div className="col-md-6 mb-3">
                        <label className="form-label">{tt('admin.taxes.b2b.exemptWithTaxId', 'Tax-exempt with Tax ID?')}</label>
                        <div className="form-check form-switch">
                          <input
                            className="form-check-input"
                            type="checkbox"
                            checked={!!form.b2bConfig?.taxExemptWithTaxId}
                            onChange={(e) => setB2B({ taxExemptWithTaxId: e.target.checked })}
                          />
                        </div>
                        <div className="form-text">{tt('admin.taxes.b2b.exemptHint', 'If enabled, an order with a valid Tax ID (NIT) is marked exempt.')}</div>
                      </div>
                      <div className="col-md-6 mb-3">
                        <label className="form-label">{tt('admin.taxes.b2b.numberingEnabled', 'Invoice numbering enabled')}</label>
                        <div className="form-check form-switch">
                          <input
                            className="form-check-input"
                            type="checkbox"
                            checked={!!form.b2bConfig?.invoiceNumbering?.enabled}
                            onChange={(e) =>
                              setB2B({
                                invoiceNumbering: {
                                  ...(form.b2bConfig?.invoiceNumbering || {}),
                                  enabled: e.target.checked,
                                },
                              })
                            }
                          />
                        </div>
                      </div>
                    </div>

                    {form.b2bConfig?.invoiceNumbering?.enabled && (
                      <div className="row">
                        <div className="col-md-3 mb-3">
                          <label className="form-label">{tt('admin.taxes.b2b.series', 'Series')}</label>
                          <input
                            className="form-control"
                            value={form.b2bConfig?.invoiceNumbering?.series || ''}
                            onChange={(e) =>
                              setB2B({
                                invoiceNumbering: {
                                  ...(form.b2bConfig?.invoiceNumbering || { enabled: true }),
                                  series: e.target.value || undefined,
                                },
                              })
                            }
                          />
                        </div>
                        <div className="col-md-3 mb-3">
                          <label className="form-label">{tt('admin.taxes.b2b.prefix', 'Prefix')}</label>
                          <input
                            className="form-control"
                            value={form.b2bConfig?.invoiceNumbering?.prefix || ''}
                            onChange={(e) =>
                              setB2B({
                                invoiceNumbering: {
                                  ...(form.b2bConfig?.invoiceNumbering || { enabled: true }),
                                  prefix: e.target.value || undefined,
                                },
                              })
                            }
                          />
                        </div>
                        <div className="col-md-3 mb-3">
                          <label className="form-label">{tt('admin.taxes.b2b.suffix', 'Suffix')}</label>
                          <input
                            className="form-control"
                            value={form.b2bConfig?.invoiceNumbering?.suffix || ''}
                            onChange={(e) =>
                              setB2B({
                                invoiceNumbering: {
                                  ...(form.b2bConfig?.invoiceNumbering || { enabled: true }),
                                  suffix: e.target.value || undefined,
                                },
                              })
                            }
                          />
                        </div>
                        <div className="col-md-3 mb-3">
                          <label className="form-label">{tt('admin.taxes.b2b.padding', 'Padding')}</label>
                          <input
                            type="number"
                            min={0}
                            className="form-control"
                            value={String(form.b2bConfig?.invoiceNumbering?.padding ?? '')}
                            onChange={(e) =>
                              setB2B({
                                invoiceNumbering: {
                                  ...(form.b2bConfig?.invoiceNumbering || { enabled: true }),
                                  padding: e.target.value ? Math.max(0, parseInt(e.target.value)) : undefined,
                                },
                              })
                            }
                          />
                        </div>
                        <div className="col-md-6 mb-3">
                          <label className="form-label">{tt('admin.taxes.b2b.resetPolicy', 'Reset policy')}</label>
                          <select
                            className="form-select"
                            value={form.b2bConfig?.invoiceNumbering?.resetPolicy || 'never'}
                            onChange={(e) =>
                              setB2B({
                                invoiceNumbering: {
                                  ...(form.b2bConfig?.invoiceNumbering || { enabled: true }),
                                  resetPolicy: e.target.value as any,
                                },
                              })
                            }
                          >
                            <option value="never">{tt('admin.taxes.b2b.reset.never', 'never')}</option>
                            <option value="yearly">{tt('admin.taxes.b2b.reset.yearly', 'yearly')}</option>
                            <option value="monthly">{tt('admin.taxes.b2b.reset.monthly', 'monthly')}</option>
                            <option value="daily">{tt('admin.taxes.b2b.reset.daily', 'daily')}</option>
                          </select>
                        </div>
                      </div>
                    )}
                    
                  </div>
                </div>
              </div>
              {/* Side column */}
              <div className="col-12 col-lg-4">
                {/* Inline test */}
                <div className="card shadow-sm mb-3">
                  <div className="card-header"><strong>{tt('admin.taxes.inlineTest.title', 'Inline test')}</strong></div>
                  <div className="card-body">
                    <InlineTest profile={form} tt={tt} />
                  </div>
                </div>

                {/* Existing profiles (manage) */}
                <div className="card shadow-sm">
                  <div className="card-header"><strong>{tt('admin.taxes.existing.title', 'Existing profiles')}</strong></div>
                  <div className="card-body">
                    {profiles.length === 0 ? (
                      <div className="text-muted small">{tt('admin.taxes.existing.none', 'No profiles found.')}</div>
                    ) : (
                      <div className="d-flex flex-column gap-2">
                        {profiles.map((p) => {
                          const d: any = p.data || {};
                          return (
                            <div key={p.id} className="border rounded p-2">
                              <div className="d-flex justify-content-between align-items-start">
                                <div className="me-2">
                                  <div className="fw-semibold">
                                    {p.id}{' '}
                                    {p.active && <span className="badge bg-success">{tt('common.active', 'active')}</span>}
                                  </div>
                                  <div className="small text-muted">
                                    {String(d.country || 'GT')} · {String(d.currency || 'USD')} ·{' '}
                                    {tt('admin.taxes.existing.inclTax', 'inclTax')}={String(!!d.pricesIncludeTax)} · {tt('admin.taxes.existing.rates', 'rates')}={Array.isArray(d.rates) ? d.rates.length : 0}
                                  </div>
                                </div>
                                <div className="btn-group btn-group-sm">
                                  <button className="btn btn-outline-primary" onClick={() => loadProfileIntoEditor(p.id)}>
                                    {tt('common.load', 'Load')}
                                  </button>
                                  <button
                                    className="btn btn-outline-success"
                                    onClick={() => setActiveProfile(p.id)}
                                    disabled={p.active}
                                    title={tt('admin.taxes.existing.setActiveTitle', 'Set this profile active now')}
                                  >
                                    {tt('admin.taxes.existing.setActive', 'Set active')}
                                  </button>
                                  <button
                                    className="btn btn-outline-danger"
                                    onClick={() => removeProfile(p.id, p.active)}
                                    disabled={p.active}
                                  >
                                    {tt('common.delete', 'Delete')}
                                  </button>
                                </div>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                    <div className="small text-muted mt-2">
                      {tt('admin.taxes.existing.hint', 'Use “Load” to edit here and “Save profile” to activate it. “Set active” activates the profile as currently stored.')}
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </main>
        </ToolGate>
      </AdminOnly>
    </Protected>
  );
}

/* ====================== Rates Editor ====================== */
function RatesEditor({
  rates,
  onChange,
  pricesIncludeTax,
  tt,
}: {
  rates: TaxRateRule[];
  onChange: (next: TaxRateRule[]) => void;
  pricesIncludeTax: boolean;
  tt: (k: string, fb: string, v?: Record<string, unknown>) => string;
}) {
  const addRate = () => {
    const suffix = rates.length + 1;
    onChange([
      ...rates,
      {
        code: `rate_${suffix}`,
        label: '',
        rateBps: 0,
      },
    ]);
  };
  const removeRate = (idx: number) => {
    const next = rates.slice();
    next.splice(idx, 1);
    onChange(next);
  };
  const update = (idx: number, patch: Partial<TaxRateRule>) => {
    const next = rates.slice();
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };

  return (
    <div className="card shadow-sm mb-3">
      <div className="card-header d-flex align-items-center justify-content-between">
        <strong>{tt('admin.taxes.rates.title', 'Tax rates')}</strong>
        <button className="btn btn-sm btn-outline-primary" onClick={addRate}>
          {tt('admin.taxes.rates.add', 'Add rate')}
        </button>
      </div>
      <div className="card-body">
        {rates.length === 0 && <div className="text-muted small">{tt('admin.taxes.rates.none', 'No rates yet.')}</div>}

        {rates.map((r, idx) => (
          <div className="border rounded p-2 mb-3" key={idx}>
            <div className="d-flex justify-content-between align-items-start">
              <div className="w-100">
                <div className="row">
                  <div className="col-md-3 mb-2">
                    <label className="form-label">{tt('admin.taxes.rates.code', 'Code')}</label>
                    <input
                      className="form-control"
                      value={r.code || ''}
                      onChange={(e) => update(idx, { code: e.target.value.trim() })}
                    />
                  </div>
                  <div className="col-md-3 mb-2">
                    <label className="form-label">{tt('admin.taxes.rates.label', 'Label')}</label>
                    <input
                      className="form-control"
                      value={r.label || ''}
                      onChange={(e) => update(idx, { label: e.target.value })}
                    />
                  </div>
                  <div className="col-md-3 mb-2">
                    <label className="form-label">{tt('admin.taxes.rates.ratePct', 'Rate (%)')}</label>
                    <div className="input-group">
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        className="form-control"
                        value={((r.rateBps || 0) / 100).toString()}
                        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                          update(idx, { rateBps: Math.round(parseFloat(e.target.value || '0') * 100) })
                        }
                      />
                      <span className="input-group-text">%</span>
                    </div>
                    <div className="form-text">
                      {pricesIncludeTax ? tt('admin.taxes.rates.inclusive', 'Inclusive') : tt('admin.taxes.rates.exclusive', 'Exclusive')} · 12.00% → 1200 bps
                    </div>
                  </div>
                  <div className="col-md-3 mb-2">
                    <label className="form-label">{tt('admin.taxes.rates.appliesTo', 'Applies to')}</label>
                    <select
                      className="form-select"
                      value={r.appliesTo === 'all' ? 'all' : 'filtered'}
                      onChange={(e) => update(idx, { appliesTo: e.target.value === 'all' ? 'all' : undefined })}
                    >
                      <option value="filtered">{tt('admin.taxes.rates.filtered', 'Filtered')}</option>
                      <option value="all">{tt('admin.taxes.rates.allItems', 'All items')}</option>
                    </select>
                    <div className="form-text">{tt('admin.taxes.rates.appliesHint', 'If “All items” is selected, filters are ignored.')}</div>
                  </div>
                </div>

                {r.appliesTo !== 'all' && (
                  <div className="mt-2">
                    <div className="row">
                      <div className="col-md-4 mb-2">
                        <label className="form-label">{tt('admin.taxes.rates.categoriesCsv', 'Categories (CSV)')}</label>
                        <input
                          className="form-control"
                          placeholder={tt('admin.taxes.rates.categoriesPh', 'e.g., food, beverage')}
                          value={arrayToCsv(r.itemCategoryIn)}
                          onChange={(e) => update(idx, { itemCategoryIn: csvToArray(e.target.value) })}
                        />
                      </div>
                      <div className="col-md-4 mb-2">
                        <label className="form-label">{tt('admin.taxes.rates.tagsInCsv', 'Tags include (CSV)')}</label>
                        <input
                          className="form-control"
                          placeholder={tt('admin.taxes.rates.tagsInPh', 'e.g., gluten_free, promo')}
                          value={arrayToCsv(r.itemTagIn)}
                          onChange={(e) => update(idx, { itemTagIn: csvToArray(e.target.value) })}
                        />
                      </div>
                      <div className="col-md-4 mb-2">
                        <label className="form-label">{tt('admin.taxes.rates.tagsExCsv', 'Tags exclude (CSV)')}</label>
                        <input
                          className="form-control"
                          placeholder={tt('admin.taxes.rates.tagsExPh', 'e.g., non_taxable')}
                          value={arrayToCsv(r.excludeItemTagIn)}
                          onChange={(e) => update(idx, { excludeItemTagIn: csvToArray(e.target.value) })}
                        />
                      </div>
                    </div>

                    <div className="mt-2">
                      <label className="form-label">{tt('admin.taxes.rates.orderTypes', 'Order types')}</label>
                      <div className="d-flex flex-wrap gap-3">
                        {ORDER_TYPES.map((ot) => {
                          const set = new Set(r.orderTypeIn || []);
                          const checked = set.has(ot);
                          return (
                            <label key={ot} className="d-flex align-items-center gap-2">
                              <input
                                type="checkbox"
                                className="form-check-input"
                                checked={checked}
                                onChange={(e) => {
                                  const next = new Set(r.orderTypeIn || []);
                                  if (e.target.checked) next.add(ot);
                                  else next.delete(ot);
                                  update(idx, { orderTypeIn: Array.from(next) as OrderType[] });
                                }}
                              />
                              <span>{ot}</span>
                            </label>
                          );
                        })}
                      </div>
                      <div className="form-text">{tt('admin.taxes.rates.orderTypesHint', 'If empty, the rate applies to all order types.')}</div>
                    </div>
                  </div>
                )}
              </div>

              <div className="ms-2">
                <button
                  className="btn btn-outline-danger btn-sm"
                  onClick={() => removeRate(idx)}
                  title={tt('admin.taxes.rates.removeTitle', 'Remove rate')}
                >
                  {tt('common.remove', 'Remove')}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="card-footer">
      </div>
    </div>
  );
}

/* ====================== Jurisdictions Editor ====================== */
function JurisdictionsEditor({
  jurisdictions,
  onChange,
  rateCodes,
  tt,
}: {
  jurisdictions: JurisdictionRule[];
  onChange: (next: JurisdictionRule[]) => void;
  rateCodes: string[];
  tt: (k: string, fb: string, v?: Record<string, unknown>) => string;
}) {
  const addJur = () => {
    onChange([
      ...jurisdictions,
      {
        code: `jur_${jurisdictions.length + 1}`,
        match: {},
      } as JurisdictionRule,
    ]);
  };
  const removeJur = (idx: number) => {
    const next = jurisdictions.slice();
    next.splice(idx, 1);
    onChange(next);
  };
  const updateJur = (idx: number, patch: Partial<JurisdictionRule>) => {
    const next = jurisdictions.slice();
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };

  const updateMatch = (idx: number, key: 'country' | 'state' | 'city' | 'zipPrefix', value?: string) => {
    const j = jurisdictions[idx] || ({} as any);
    updateJur(idx, { match: { ...(j.match || {}), [key]: value || undefined } as any });
  };

  const setRates = (idx: number, rates: TaxRateRule[]) => {
    updateJur(idx, { ratesOverride: rates });
  };

  const setDelivery = (idx: number, patch: any) => {
    const cur = jurisdictions[idx]?.deliveryOverride || { mode: 'out_of_scope' };
    updateJur(idx, { deliveryOverride: { ...cur, ...patch } as any });
  };

  const addSurcharge = (idx: number) => {
    const j = jurisdictions[idx] as any;
    const list = Array.isArray(j.surchargesOverride) ? j.surchargesOverride.slice() : [];
    list.push({ code: `svc_${list.length + 1}`, label: '', percentBps: 0, taxable: false });
    updateJur(idx, { surchargesOverride: list });
  };
  const updSurcharge = (idx: number, sIdx: number, patch: any) => {
    const j = jurisdictions[idx] as any;
    const list = Array.isArray(j.surchargesOverride) ? j.surchargesOverride.slice() : [];
    list[sIdx] = { ...list[sIdx], ...patch };
    updateJur(idx, { surchargesOverride: list });
  };
  const delSurcharge = (idx: number, sIdx: number) => {
    const j = jurisdictions[idx] as any;
    const list = Array.isArray(j.surchargesOverride) ? j.surchargesOverride.slice() : [];
    list.splice(sIdx, 1);
    updateJur(idx, { surchargesOverride: list.length ? list : undefined });
  };

  return (
    <div className="card shadow-sm mb-3">
      <div className="card-header d-flex justify-content-between align-items-center">
        <strong>{tt('admin.taxes.jur.editorTitle', 'Jurisdictions (editor)')}</strong>
        <button className="btn btn-sm btn-outline-primary" onClick={addJur}>{tt('admin.taxes.jur.addRule', 'Add rule')}</button>
      </div>
      <div className="card-body">
        {(!jurisdictions || jurisdictions.length === 0) && (
          <div className="text-muted">
            {tt('admin.taxes.jur.none', 'No jurisdiction overrides configured.')}
            <div className="small">{tt('admin.taxes.jur.createHint', '(Create them here. They are saved with “Save profile”.)')}</div>
          </div>
        )}

        {jurisdictions.map((j, idx) => (
          <div key={idx} className="border rounded p-2 mb-3">
            <div className="d-flex justify-content-between align-items-start">
              <div className="w-100">
                <div className="row">
                  <div className="col-md-3 mb-2">
                    <label className="form-label">{tt('admin.taxes.rates.code', 'Code')}</label>
                    <input
                      className="form-control"
                      value={j.code || ''}
                      onChange={(e) => updateJur(idx, { code: e.target.value.trim() })}
                    />
                  </div>
                  <div className="col-md-9 mb-2">
                    <label className="form-label">{tt('admin.taxes.jur.match', 'Match')}</label>
                    <div className="row">
                      <div className="col-md-3 mb-2">
                        <input
                          className="form-control"
                          placeholder={tt('admin.taxes.jur.country', 'country')}
                          value={j.match?.country || ''}
                          onChange={(e) => updateMatch(idx, 'country', e.target.value)}
                        />
                      </div>
                      <div className="col-md-3 mb-2">
                        <input
                          className="form-control"
                          placeholder={tt('admin.taxes.jur.state', 'state')}
                          value={(j.match as any)?.state || ''}
                          onChange={(e) => updateMatch(idx, 'state', e.target.value)}
                        />
                      </div>
                      <div className="col-md-3 mb-2">
                        <input
                          className="form-control"
                          placeholder={tt('admin.taxes.jur.city', 'city')}
                          value={j.match?.city || ''}
                          onChange={(e) => updateMatch(idx, 'city', e.target.value)}
                        />
                      </div>
                      <div className="col-md-3 mb-2">
                        <input
                          className="form-control"
                          placeholder={tt('admin.taxes.jur.zipPrefix', 'zipPrefix')}
                          value={j.match?.zipPrefix || ''}
                          onChange={(e) => updateMatch(idx, 'zipPrefix', e.target.value)}
                        />
                      </div>
                    </div>
                    <div className="small text-muted">{tt('admin.taxes.jur.priority', 'Priority: zipPrefix > city > state > country.')}</div>
                  </div>
                </div>

                {/* Overrides: rates */}
                <div className="mt-2">
                  <div className="d-flex justify-content-between align-items-center">
                    <strong>{tt('admin.taxes.jur.ratesOverride', 'Rates override')}</strong>
                  </div>
                  <RatesEditor
                    rates={j.ratesOverride || []}
                    onChange={(next) => setRates(idx, next)}
                    pricesIncludeTax={true}
                    tt={tt}
                  />
                </div>

                {/* Overrides: surcharges */}
                <div className="mt-2">
                  <div className="d-flex justify-content-between align-items-center">
                    <strong>{tt('admin.taxes.jur.surchargesOverride', 'Surcharges override')}</strong>
                    <button className="btn btn-sm btn-outline-secondary" onClick={() => addSurcharge(idx)}>
                      {tt('admin.taxes.jur.addSurcharge', 'Add surcharge')}
                    </button>
                  </div>
                  {Array.isArray((j as any).surchargesOverride) && (j as any).surchargesOverride.length > 0 ? (
                    <div className="mt-2 d-flex flex-column gap-2">
                      {(j as any).surchargesOverride.map((s: any, sIdx: number) => (
                        <div key={sIdx} className="border rounded p-2">
                          <div className="row">
                            <div className="col-md-3 mb-2">
                              <label className="form-label">{tt('admin.taxes.rates.code', 'Code')}</label>
                              <input className="form-control" value={s.code || ''} onChange={(e) => updSurcharge(idx, sIdx, { code: e.target.value })} />
                            </div>
                            <div className="col-md-3 mb-2">
                              <label className="form-label">{tt('admin.taxes.rates.label', 'Label')}</label>
                              <input className="form-control" value={s.label || ''} onChange={(e) => updSurcharge(idx, sIdx, { label: e.target.value })} />
                            </div>
                            <div className="col-md-3 mb-2">
                              <label className="form-label">{tt('admin.taxes.service.rate', 'Rate (%)')}</label>
                              <div className="input-group">
                                <input
                                  type="number"
                                  min={0}
                                  step="0.01"
                                  className="form-control"
                                  value={((s.percentBps || 0) / 100).toString()}
                                  onChange={(e) => updSurcharge(idx, sIdx, { percentBps: Math.round(parseFloat(e.target.value || '0') * 100) })}
                                />
                                <span className="input-group-text">%</span>
                              </div>
                            </div>
                            <div className="col-md-3 mb-2">
                              <label className="form-label">{tt('admin.taxes.service.taxable', 'Taxable?')}</label>
                              <div className="form-check form-switch">
                                <input
                                  className="form-check-input"
                                  type="checkbox"
                                  checked={!!s.taxable}
                                  onChange={(e) => updSurcharge(idx, sIdx, { taxable: e.target.checked })}
                                />
                              </div>
                              {s.taxable && (
                                <div className="mt-2">
                                  <label className="form-label">{tt('admin.taxes.service.taxCode', 'Tax code')}</label>
                                  <select
                                    className="form-select"
                                    value={s.taxCode || ''}
                                    onChange={(e) => updSurcharge(idx, sIdx, { taxCode: e.target.value || undefined })}
                                  >
                                    <option value="">{tt('common.choose', '(choose)')}</option>
                                    {rateCodes.map((c) => <option key={c} value={c}>{c}</option>)}
                                  </select>
                                </div>
                              )}
                            </div>
                          </div>
                          <div className="text-end">
                            <button className="btn btn-sm btn-outline-danger" onClick={() => delSurcharge(idx, sIdx)}>
                              {tt('admin.taxes.jur.removeSurcharge', 'Remove surcharge')}
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-muted small mt-1">{tt('admin.taxes.jur.noSurcharges', 'No surcharges override.')}</div>
                  )}
                </div>

                {/* Overrides: delivery */}
                <div className="mt-2">
                  <strong>{tt('admin.taxes.jur.deliveryOverride', 'Delivery override')}</strong>
                  <div className="row mt-1">
                    <div className="col-md-4 mb-2">
                      <label className="form-label">{tt('admin.taxes.delivery.mode', 'Mode')}</label>
                      <select
                        className="form-select"
                        value={(j as any).deliveryOverride?.mode || 'out_of_scope'}
                        onChange={(e) => setDelivery(idx, { mode: e.target.value })}
                      >
                        <option value="out_of_scope">{tt('admin.taxes.delivery.outOfScope', 'Out of scope')}</option>
                        <option value="as_line">{tt('admin.taxes.delivery.asLineShort', 'As line')}</option>
                      </select>
                    </div>
                    <div className="col-md-4 mb-2">
                      <label className="form-label">{tt('admin.taxes.delivery.taxable', 'Taxable?')}</label>
                      <div className="form-check form-switch">
                        <input
                          className="form-check-input"
                          type="checkbox"
                          checked={!!(j as any).deliveryOverride?.taxable}
                          onChange={(e) => setDelivery(idx, { taxable: e.target.checked })}
                        />
                      </div>
                    </div>
                    <div className="col-md-4 mb-2">
                      <label className="form-label">{tt('admin.taxes.service.taxCode', 'Tax code')}</label>
                      <select
                        className="form-select"
                        value={(j as any).deliveryOverride?.taxCode || ''}
                        onChange={(e) => setDelivery(idx, { taxCode: e.target.value || undefined })}
                        disabled={!((j as any).deliveryOverride?.taxable)}
                      >
                        <option value="">{tt('common.choose', '(choose)')}</option>
                        {rateCodes.map((c) => <option key={c} value={c}>{c}</option>)}
                      </select>
                    </div>
                  </div>
                </div>

                {/* Overrides: flags */}
                <div className="row mt-2">
                  <div className="col-md-6 mb-2">
                    <label className="form-label">{tt('admin.taxes.jur.pricesIncludeOverride', 'pricesIncludeTax override')}</label>
                    <div className="form-check form-switch">
                      <input
                        className="form-check-input"
                        type="checkbox"
                        checked={(j as any).pricesIncludeTaxOverride === true}
                        onChange={(e) =>
                          updateJur(idx, { pricesIncludeTaxOverride: e.target.checked ? true : undefined } as any)
                        }
                      />
                    </div>
                  </div>
                  <div className="col-md-6 mb-2">
                    <label className="form-label">{tt('admin.taxes.jur.roundingOverride', 'rounding override')}</label>
                    <select
                      className="form-select"
                      value={(j as any).roundingOverride || ''}
                      onChange={(e) =>
                        updateJur(idx, { roundingOverride: (e.target.value || undefined) as any })
                      }
                    >
                      <option value="">{tt('common.inherit', '(inherit)')}</option>
                      <option value="half_up">half_up</option>
                      <option value="half_even">half_even</option>
                    </select>
                  </div>
                </div>
              </div>

              <div className="ms-2">
                <button className="btn btn-outline-danger btn-sm" onClick={() => removeJur(idx)}>
                  {tt('common.remove', 'Remove')}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div className="card-footer">
      </div>
    </div>
  );
}

/* ====================== Inline Test ====================== */
function InlineTest({ profile, tt }: { profile: TaxProfile; tt: (k: string, fb: string, v?: Record<string, unknown>) => string }) {
  const [qty, setQty] = useState(2);
  const [unit, setUnit] = useState(2500); // 25.00
  const [addons, setAddons] = useState(0);

  const { calculateTaxSnapshot } = require('@/lib/tax/engine'); // client-only demo
  const snapshot = useMemo(() => {
    try {
      return calculateTaxSnapshot(
        {
          currency: profile.currency,
          orderType: 'dine-in',
          lines: [{ lineId: 'demo', quantity: qty, unitPriceCents: unit, addonsCents: addons }],
          customer: {},
        },
        profile
      );
    } catch {
      return null;
    }
  }, [qty, unit, addons, profile]);

  return (
    <div>
      <div className="mb-2">
        <label className="form-label">{tt('common.qty', 'Qty')}</label>
        <input
          type="number"
          className="form-control"
          value={qty}
          onChange={(e) => setQty(parseInt(e.target.value || '0'))}
        />
      </div>
      <div className="mb-2">
        <label className="form-label">{tt('admin.taxes.inlineTest.unitCents', 'Unit price (cents)')}</label>
        <input
          type="number"
          className="form-control"
          value={unit}
          onChange={(e) => setUnit(parseInt(e.target.value || '0'))}
        />
      </div>
      <div className="mb-2">
        <label className="form-label">{tt('admin.taxes.inlineTest.addonsCents', 'Addons (cents)')}</label>
        <input
          type="number"
          className="form-control"
          value={addons}
          onChange={(e) => setAddons(parseInt(e.target.value || '0'))}
        />
      </div>

      {snapshot ? (
        <div className="mt-2 small">
          <div>{tt('admin.taxes.inlineTest.subtotal', 'Subtotal')}: {fmtMoneyCents(snapshot.totals.subTotalCents, snapshot.currency)}</div>
          <div>{tt('admin.taxes.inlineTest.tax', 'Tax')}: {fmtMoneyCents(snapshot.totals.taxCents, snapshot.currency)}</div>
          <div className="fw-semibold">{tt('admin.taxes.inlineTest.grandTotal', 'Grand total')}: {fmtMoneyCents(snapshot.totals.grandTotalCents, snapshot.currency)}</div>
        </div>
      ) : (
        <div className="text-muted">—</div>
      )}
    </div>
  );
}
