// src/lib/plans/features.ts
import type { FeatureKey, FeatureMap, FeatureRouteMap, PlanTier, TenantPlanDoc } from './types';

/**
 * Rutas (admin) por feature — útil para sidebars y redirecciones.
 * NOTA: alineadas con el panel que usa `/admin/...`
 */
export const FEATURE_ROUTES: FeatureRouteMap = {
  // Core
  kitchen:         '/app/admin/kitchen',
  cashier:         '/app/admin/cashier',
  menu:            '/app/admin/menu',
  roles:           '/app/admin/roles',
  taxes:           '/app/admin/taxes',
  settings:        '/app/admin/settings',
  homeConfigure:   '/app/admin/home-configure',
  orders:          '/app/admin/orders',
  waiter:          '/app/admin/waiter',
  editOrders:      '/app/admin/edit-orders',
  promotions:      '/app/admin/promotions',
  delivery:        '/app/admin/delivery',
  deliveryOptions: '/app/admin/delivery-options',
  ops:             '/app/admin/ops',
  marketing:       '/app/admin/marketing',
  aiStudio:        '/app/admin/ai-studio',

  // Reports (módulo base + subrutas)
  reports:          '/app/admin/reports',
  salesReports:     '/app/admin/reports/sales-reports',
  taxesReports:     '/app/admin/reports/taxes',
  productReports:   '/app/admin/reports/product-reports',
  clientReports:    '/app/admin/reports/client-reports',
  promotionReports: '/app/admin/reports/promotion-reports',
  timeReports:      '/app/admin/reports/time-reports',
  deliveryReports:  '/app/admin/reports/delivery-reports',
  cashierReports:   '/app/admin/reports/cashier-reports',
};

/**
 * Defaults por plan (admin).
 * Incluye `reports: true` en todos los planes para mostrar el tile principal,
 * y usa flags granulares para controlar las secciones internas.
 */
export const DEFAULT_FEATURES: Record<PlanTier, FeatureMap> = {
  starter: {
    // Core
    kitchen: true, cashier: true, menu: true, roles: true, taxes: true,
    settings: true, homeConfigure: true, orders: true,
    waiter: false, editOrders: false, promotions: false,
    delivery: false, deliveryOptions: false, ops: false, marketing: false, aiStudio: false,

    // Reports
    reports: true,
    salesReports: true, taxesReports: true, productReports: true,
    clientReports: false,
    promotionReports: false, timeReports: false,
    deliveryReports: false, cashierReports: false,
  },

  pro: {
    // Core
    kitchen: true, cashier: true, menu: true, roles: true, taxes: true,
    settings: true, homeConfigure: true, orders: true,
    waiter: true, editOrders: true, promotions: true,
    delivery: false, deliveryOptions: false, ops: false, marketing: false, aiStudio: false,

    // Reports
    reports: true,
    salesReports: true, taxesReports: true, productReports: true, clientReports: true,
    promotionReports: true, timeReports: true,
    deliveryReports: false, cashierReports: false,
  },

  full: {
    // Core
    kitchen: true, cashier: true, menu: true, roles: true, taxes: true,
    settings: true, homeConfigure: true, orders: true,
    waiter: true, editOrders: true, promotions: true,
    delivery: true, deliveryOptions: true, ops: true, marketing: true, aiStudio: true,

    // Reports
    reports: true,
    salesReports: true, taxesReports: true, productReports: true, clientReports: true,
    promotionReports: true, timeReports: true,
    deliveryReports: true, cashierReports: true,
  },
};

/**
 * Fusiona el doc guardado con los defaults del tier.
 * - `features` puede venir vacío o parcial; se completa con defaults.
 * - Ignora claves desconocidas (fuera de FeatureMap).
 * - Timestamps opcionales (no se incluyen si no existen).
 */
export function coercePlan(doc?: Partial<TenantPlanDoc>): TenantPlanDoc {
  const tier = (doc?.planTier ?? 'starter') as PlanTier;
  const base = DEFAULT_FEATURES[tier];

  const raw = (doc?.features ?? {}) as Record<string, boolean>;
  const normalized = Object.fromEntries(
    Object.keys(base).map((k) => [k, k in raw ? !!raw[k] : base[k as keyof FeatureMap]])
  ) as FeatureMap;

  return {
    planTier: tier,
    features: normalized,
    tenantId: doc?.tenantId,
    ...(doc?.createdAt ? { createdAt: doc.createdAt } : {}),
    ...(doc?.updatedAt ? { updatedAt: doc.updatedAt } : {}),
  };
}

/** Helper de lectura: ¿el plan tiene habilitada una feature? */
export function hasFeature(plan: TenantPlanDoc, feature: FeatureKey): boolean {
  return !!(plan?.features as FeatureMap)?.[feature];
}

/** Lista de features activas (útil para sidebars/menus). */
export function listEnabledFeatures(plan: TenantPlanDoc): FeatureKey[] {
  const features = (plan?.features || {}) as Record<string, boolean>;
  return Object.entries(features)
    .filter(([, v]) => !!v)
    .map(([k]) => k as FeatureKey);
}

/** 
 * 🔗 Export adicional: lista de claves activas por plan (para usar en APIs, p.ej. provision-tenant).
 * Se deriva de DEFAULT_FEATURES para evitar drift.
 */
export const PLAN_FEATURES: Record<PlanTier, FeatureKey[]> = Object.fromEntries(
  (['starter','pro','full'] as PlanTier[]).map((tier) => [
    tier,
    Object.entries(DEFAULT_FEATURES[tier])
      .filter(([, v]) => !!v)
      .map(([k]) => k as FeatureKey),
  ])
) as Record<PlanTier, FeatureKey[]>;
