/** Planes soportados en el área ADMIN (cliente siempre libre). */
export type PlanTier = 'starter' | 'pro' | 'full';

/** Claves de features (todas son del área ADMIN). */
export type FeatureKey =
  // Core
  | 'kitchen'           // admin/kitchen
  | 'cashier'           // admin/cashier
  | 'menu'              // admin/menu
  | 'roles'             // admin/roles
  | 'taxes'             // admin/taxes
  | 'settings'          // admin/settings  (idioma/moneda)
  | 'homeConfigure'     // admin/home-configure
  | 'orders'            // admin/orders
  | 'waiter'            // admin/waiter (Mesas)
  | 'editOrders'        // admin/edit-orders
  | 'promotions'        // admin/promotions
  | 'delivery'          // admin/delivery
  | 'deliveryOptions'   // admin/delivery-options
  | 'ops'               // admin/ops
  | 'marketing'         // admin/marketing
  | 'aiStudio'          // admin/ai-studio

  // Reports hub + subreportes
  | 'reports'           // admin/reports (hub)
  | 'salesReports'      // admin/reports/sales-reports
  | 'taxesReports'      // admin/reports/taxes
  | 'productReports'    // admin/reports/product-reports (Productos)
  | 'clientReports'     // admin/reports/client-reports (Clientes)
  | 'promotionReports'  // admin/reports/promotion-reports
  | 'timeReports'       // admin/reports/time-reports
  | 'deliveryReports'   // admin/reports/delivery-reports
  | 'cashierReports';   // admin/reports/cashier-reports

/** Mapa de bandera por feature. */
export type FeatureMap = Record<FeatureKey, boolean>;

/**
 * Documento canónico guardado en, p.ej.:
 *   tenants/{tenantId}/system_flags/plan
 * o directamente embebido en tenants/{tenantId} si lo prefieres.
 */
export type TenantPlanDoc = {
  planTier: PlanTier;
  /**
   * Overrides opcionales por feature (true/false).
   * Si está vacío o parcial, se usan/completan con los defaults del tier.
   * ⚠️ En la práctica, también toleraremos un array<string> desde Firestore.
   */
  features: FeatureMap | Record<string, boolean> | string[];

  /** Timestamps opcionales (Opción A) */
  createdAt?: unknown; // Firestore Timestamp | Date
  updatedAt?: unknown; // Firestore Timestamp | Date

  /** Opcional: útil si haces collectionGroup o normalizas el doc. */
  tenantId?: string;
};

/** Mapa de rutas por feature (para sidebars/guards de navegación). */
export type FeatureRouteMap = Record<FeatureKey, string>;
