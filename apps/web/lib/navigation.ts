import { isPermission, type ModuleKey, type Permission, type TermKey } from '@bms/types';

export interface NavigationEntry {
  key: string;
  href: string;
  /** Shown text: a workspace term (plural) or a message key under `nav`. */
  label: { term: TermKey } | { message: string };
  area:
    | 'home'
    | 'crm'
    | 'sales'
    | 'pos'
    | 'products'
    | 'inventory'
    | 'purchasing'
    | 'finance'
    | 'staff'
    | 'automation'
    | 'integrations'
    | 'reports'
    | 'settings';
  /** The entry shows when the user holds ANY of these; empty means any signed-in user. */
  permissions: readonly Permission[];
  /** Hidden while the workspace has this module switched off. */
  module?: ModuleKey;
  /** False until the screen exists; each screen task switches its entry on. */
  available: boolean;
}

/**
 * The single registry of navigation entries (Requirement 49.1). Entries are hidden for users who lack
 * the permission or whose workspace switched the module off (Requirement 49.2); the API still enforces both.
 */
export const NAVIGATION: readonly NavigationEntry[] = [
  {
    key: 'home',
    href: '/',
    label: { message: 'home' },
    area: 'home',
    permissions: [],
    available: true,
  },
  {
    key: 'customers',
    href: '/customers',
    label: { term: 'customer' },
    area: 'crm',
    permissions: ['customer:view'],
    available: false,
  },
  {
    key: 'leads',
    href: '/leads',
    label: { term: 'lead' },
    area: 'crm',
    permissions: ['lead:view'],
    available: false,
  },
  {
    key: 'conversations',
    href: '/conversations',
    label: { message: 'conversations' },
    area: 'crm',
    permissions: ['conversation:view'],
    module: 'messaging',
    available: false,
  },
  {
    key: 'tasks',
    href: '/tasks',
    label: { message: 'tasks' },
    area: 'crm',
    permissions: ['task:view'],
    available: false,
  },
  {
    key: 'quotations',
    href: '/quotations',
    label: { term: 'quotation' },
    area: 'sales',
    permissions: ['quotation:view'],
    available: false,
  },
  {
    key: 'orders',
    href: '/orders',
    label: { term: 'order' },
    area: 'sales',
    permissions: ['order:view'],
    available: false,
  },
  {
    key: 'pos',
    href: '/pos',
    label: { message: 'pos' },
    area: 'pos',
    permissions: ['pos:sell'],
    module: 'pos',
    available: false,
  },
  {
    key: 'products',
    href: '/products',
    label: { term: 'product' },
    area: 'products',
    permissions: ['product:view'],
    available: false,
  },
  {
    key: 'inventory',
    href: '/inventory',
    label: { message: 'inventory' },
    area: 'inventory',
    permissions: ['inventory:view'],
    available: false,
  },
  {
    key: 'suppliers',
    href: '/purchasing/suppliers',
    label: { term: 'supplier' },
    area: 'purchasing',
    permissions: ['supplier:view'],
    module: 'purchasing',
    available: false,
  },
  {
    key: 'purchase-orders',
    href: '/purchasing/orders',
    label: { term: 'purchaseOrder' },
    area: 'purchasing',
    permissions: ['purchase:view'],
    module: 'purchasing',
    available: false,
  },
  {
    key: 'payments',
    href: '/finance/payments',
    label: { message: 'payments' },
    area: 'finance',
    permissions: ['payment:view'],
    available: false,
  },
  {
    key: 'expenses',
    href: '/finance/expenses',
    label: { message: 'expenses' },
    area: 'finance',
    permissions: ['expense:view'],
    available: false,
  },
  {
    key: 'staff',
    href: '/staff',
    label: { message: 'staff' },
    area: 'staff',
    permissions: ['user:view'],
    available: true,
  },
  {
    key: 'roles',
    href: '/staff/roles',
    label: { message: 'roles' },
    area: 'staff',
    permissions: ['role:view'],
    available: true,
  },
  {
    key: 'commissions',
    href: '/staff/commissions',
    label: { message: 'commissions' },
    area: 'staff',
    permissions: ['commission:view'],
    module: 'commissions',
    available: false,
  },
  {
    key: 'automation',
    href: '/automation/ai',
    label: { message: 'automation' },
    area: 'automation',
    permissions: ['ai:use', 'automation:view'],
    module: 'ai',
    available: false,
  },
  {
    key: 'integrations',
    href: '/integrations',
    label: { message: 'integrations' },
    area: 'integrations',
    permissions: ['integration:view'],
    available: false,
  },
  {
    key: 'reports',
    href: '/reports',
    label: { message: 'reports' },
    area: 'reports',
    permissions: ['report:view'],
    available: false,
  },
  {
    key: 'settings',
    href: '/settings/business',
    label: { message: 'settings' },
    area: 'settings',
    permissions: ['workspace:view'],
    available: true,
  },
  {
    key: 'industry',
    href: '/settings/industry',
    label: { message: 'industry' },
    area: 'settings',
    permissions: ['workspace:view'],
    available: true,
  },
  {
    key: 'audit',
    href: '/settings/audit',
    label: { message: 'audit' },
    area: 'settings',
    permissions: ['audit:view'],
    available: true,
  },
];

export interface NavigationContext {
  permissions: readonly string[];
  modules: Partial<Record<string, boolean>>;
}

export function visibleNavigation(
  entries: readonly NavigationEntry[],
  ctx: NavigationContext,
): NavigationEntry[] {
  return entries.filter((entry) => {
    if (!entry.available) return false;
    if (entry.module && ctx.modules[entry.module] !== true) return false;
    return (
      entry.permissions.length === 0 || entry.permissions.some((p) => ctx.permissions.includes(p))
    );
  });
}

/** Used by tests: every permission named in the registry must exist in the catalogue. */
export const NAVIGATION_PERMISSIONS: readonly string[] = NAVIGATION.flatMap(
  (e) => e.permissions,
).filter(isPermission);
