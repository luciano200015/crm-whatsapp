/**
 * Single source of truth for features, plans, prices and what each plan
 * includes. `npm run db:seed` syncs it to the database.
 *
 * Changing a price only affects new subscriptions: existing ones keep the
 * amount they subscribed at (subscriptions.amount_cents).
 */

export type FeatureKind = 'LIMIT' | 'BOOLEAN' | 'TEXT';

export interface FeatureDefinition {
  name: string;
  kind: FeatureKind;
  unit?: string;
  group: 'limits' | 'features';
  description?: string;
}

export const FEATURES = {
  // ── Limits (null in a plan = unlimited) ──
  'limits.agents': {
    name: 'Agentes (usuarios)',
    kind: 'LIMIT',
    unit: 'agentes',
    group: 'limits',
    description: 'Miembros activos del espacio de trabajo.',
  },
  'limits.whatsapp_lines': {
    name: 'Líneas de WhatsApp',
    kind: 'LIMIT',
    unit: 'líneas',
    group: 'limits',
  },
  'limits.active_contacts': {
    name: 'Contactos activos',
    kind: 'LIMIT',
    unit: 'contactos/mes',
    group: 'limits',
    description: 'Contactos con al menos una conversación en el mes.',
  },
  'limits.ai_credits': {
    name: 'Créditos de asistentes IA',
    kind: 'LIMIT',
    unit: 'créditos/mes',
    group: 'limits',
  },
  'limits.chat_history_months': {
    name: 'Historial de chats',
    kind: 'LIMIT',
    unit: 'meses',
    group: 'limits',
  },
  'limits.social_channels': {
    name: 'Canales sociales (Facebook e Instagram)',
    kind: 'LIMIT',
    unit: 'canales',
    group: 'limits',
  },
  // ── Included features ──
  'features.smart_inbox': {
    name: 'Bandeja de chat inteligente',
    kind: 'BOOLEAN',
    group: 'features',
  },
  'features.advanced_chatbots': {
    name: 'Chatbots avanzados',
    kind: 'BOOLEAN',
    group: 'features',
  },
  'features.auto_assignment': {
    name: 'Autoasignación de chats',
    kind: 'BOOLEAN',
    group: 'features',
  },
  'features.campaigns': {
    name: 'Campañas y envíos masivos',
    kind: 'BOOLEAN',
    group: 'features',
  },
  'features.reports': {
    name: 'Reportes y métricas',
    kind: 'BOOLEAN',
    group: 'features',
  },
  'features.mobile_app': {
    name: 'Aplicación móvil',
    kind: 'BOOLEAN',
    group: 'features',
  },
  'features.sales_funnels': {
    name: 'Embudos de venta',
    kind: 'BOOLEAN',
    group: 'features',
  },
  'features.custom_roles': {
    name: 'Gestión personalizada de roles',
    kind: 'BOOLEAN',
    group: 'features',
  },
  'features.api_access': {
    name: 'Acceso a la API',
    kind: 'BOOLEAN',
    group: 'features',
  },
  'features.webhooks': { name: 'Webhooks', kind: 'BOOLEAN', group: 'features' },
  'features.audit_log': {
    name: 'Registro de auditoría',
    kind: 'BOOLEAN',
    group: 'features',
  },
  'features.dedicated_support': {
    name: 'Canal exclusivo de soporte',
    kind: 'BOOLEAN',
    group: 'features',
  },
  'features.backups': {
    name: 'Backups automáticos',
    kind: 'TEXT',
    group: 'features',
  },
} as const satisfies Record<string, FeatureDefinition>;

export type FeatureKey = keyof typeof FEATURES;
export type LimitKey = {
  [K in FeatureKey]: (typeof FEATURES)[K]['kind'] extends 'LIMIT' ? K : never;
}[FeatureKey];

export const FEATURE_KEYS = Object.keys(FEATURES) as FeatureKey[];

/** Value of a feature in a plan: number|null for LIMIT, boolean for BOOLEAN, string|null for TEXT. */
export type FeatureValue = number | boolean | string | null;

export type BillingInterval = 'MONTH' | 'YEAR';

export interface PlanDefinition {
  name: string;
  tagline: string;
  description: string;
  highlighted?: boolean;
  isPublic?: boolean;
  /** Price in minor units (cents) per currency and interval. */
  prices: Record<string, Record<BillingInterval, number>>;
  features: Record<FeatureKey, FeatureValue>;
}

const BASE_FEATURES = {
  'features.smart_inbox': true,
  'features.advanced_chatbots': true,
  'features.auto_assignment': true,
  'features.campaigns': true,
  'features.reports': true,
  'features.mobile_app': true,
} as const;

/** Ordered from cheapest to most expensive. The first public plan is the "basic" one. */
export const PLANS = {
  team: {
    name: 'Equipo',
    tagline: 'Perfecto para pequeños equipos',
    description: 'Todo lo esencial para atender a tus clientes en equipo.',
    prices: { USD: { MONTH: 9_900, YEAR: 99_000 } },
    features: {
      'limits.agents': 3,
      'limits.whatsapp_lines': 2,
      'limits.active_contacts': 5_000,
      'limits.ai_credits': 30_000,
      'limits.chat_history_months': 6,
      'limits.social_channels': 0,
      ...BASE_FEATURES,
      'features.sales_funnels': false,
      'features.custom_roles': false,
      'features.api_access': false,
      'features.webhooks': false,
      'features.audit_log': false,
      'features.dedicated_support': false,
      'features.backups': null,
    },
  },
  business: {
    name: 'Empresa',
    tagline: 'Ideal para equipos en crecimiento',
    description:
      'Embudos de venta, API e integraciones para escalar tu operación.',
    highlighted: true,
    prices: { USD: { MONTH: 22_900, YEAR: 229_000 } },
    features: {
      'limits.agents': 10,
      'limits.whatsapp_lines': 5,
      'limits.active_contacts': 15_000,
      'limits.ai_credits': 70_000,
      'limits.chat_history_months': 12,
      'limits.social_channels': 5,
      ...BASE_FEATURES,
      'features.sales_funnels': true,
      'features.custom_roles': true,
      'features.api_access': true,
      'features.webhooks': true,
      'features.audit_log': false,
      'features.dedicated_support': false,
      'features.backups': 'Mensual',
    },
  },
  corporate: {
    name: 'Corporativo',
    tagline: 'Creado para grandes empresas',
    description: 'Máxima capacidad, auditoría y soporte dedicado.',
    prices: { USD: { MONTH: 59_900, YEAR: 599_000 } },
    features: {
      'limits.agents': 30,
      'limits.whatsapp_lines': 15,
      'limits.active_contacts': 60_000,
      'limits.ai_credits': 200_000,
      'limits.chat_history_months': 24,
      'limits.social_channels': 15,
      ...BASE_FEATURES,
      'features.sales_funnels': true,
      'features.custom_roles': true,
      'features.api_access': true,
      'features.webhooks': true,
      'features.audit_log': true,
      'features.dedicated_support': true,
      'features.backups': 'Semanal',
    },
  },
} as const satisfies Record<string, PlanDefinition>;

export type PlanCode = keyof typeof PLANS;
export const PLAN_CODES = Object.keys(PLANS) as PlanCode[];

export function isPlanCode(value: string): value is PlanCode {
  return Object.prototype.hasOwnProperty.call(PLANS, value);
}

export function isFeatureKey(value: string): value is FeatureKey {
  return Object.prototype.hasOwnProperty.call(FEATURES, value);
}
