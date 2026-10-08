import {
  PERMISSION_CATALOGUE,
  WORKSPACE_PERMISSIONS,
  type Permission,
  type PermissionResource,
} from './permissions';

export interface DefaultRoleDefinition {
  name: string;
  isOwner: boolean;
  permissions: readonly Permission[];
  maxDiscountPercent: number;
}

const actions = (resource: PermissionResource, ...names: string[]): Permission[] =>
  names.map((n) => `${resource}:${n}` as Permission);
const every = (resource: PermissionResource): Permission[] =>
  PERMISSION_CATALOGUE[resource].map((a) => `${resource}:${a}` as Permission);

const MANAGER_EXCLUDED: ReadonlySet<Permission> = new Set([
  'workspace:configure',
  'role:configure',
  'field:configure',
  'workflow:configure',
  'integration:manage',
  'account:configure',
]);

/** Resources holding financial data; Viewer never gets their `view` (Requirement 2.8, design "Default Roles"). */
const FINANCIAL_RESOURCES: ReadonlySet<PermissionResource> = new Set([
  'payment',
  'expense',
  'account',
]);

/**
 * The nine system roles created with every workspace (Requirement 2.8, design.md "Default Roles").
 * The Owner role is created with every workspace permission; platform:admin is never included.
 */
export const DEFAULT_ROLES: readonly DefaultRoleDefinition[] = [
  { name: 'Owner', isOwner: true, permissions: WORKSPACE_PERMISSIONS, maxDiscountPercent: 100 },
  {
    name: 'Manager',
    isOwner: false,
    permissions: WORKSPACE_PERMISSIONS.filter((p) => !MANAGER_EXCLUDED.has(p)),
    maxDiscountPercent: 20,
  },
  {
    name: 'Salesperson',
    isOwner: false,
    permissions: [
      ...actions('customer', 'view', 'create', 'edit'),
      ...actions('lead', 'view', 'create', 'edit'),
      ...actions('task', 'view', 'create', 'edit'),
      ...actions('conversation', 'view', 'reply'),
      ...actions('quotation', 'view', 'create', 'edit', 'send'),
      ...actions('order', 'view', 'create', 'edit'),
      ...actions('product', 'view'),
      ...actions('inventory', 'view'),
      ...actions('pos', 'sell'),
      ...actions('payment', 'view', 'create'),
      ...actions('commission', 'view'),
      ...actions('ai', 'use'),
      ...actions('report', 'view'),
    ],
    maxDiscountPercent: 5,
  },
  {
    name: 'Cashier',
    isOwner: false,
    permissions: [
      ...actions('pos', 'sell', 'open_session', 'close_session', 'cash_movement', 'reprint'),
      ...actions('customer', 'view', 'create'),
      ...actions('product', 'view'),
      ...actions('inventory', 'view'),
      ...actions('payment', 'view', 'create'),
    ],
    maxDiscountPercent: 0,
  },
  {
    name: 'Inventory Staff',
    isOwner: false,
    permissions: [
      ...actions('product', 'view', 'create', 'edit'),
      ...actions('inventory', 'view', 'adjust', 'transfer', 'count'),
      ...actions('supplier', 'view', 'create', 'edit'),
      ...actions('purchase', 'view', 'create', 'edit', 'receive'),
    ],
    maxDiscountPercent: 0,
  },
  {
    name: 'Account Staff',
    isOwner: false,
    permissions: [
      ...every('payment'),
      ...every('expense'),
      ...actions('account', 'view'),
      ...actions('report', 'view', 'financial', 'export'),
      ...actions('order', 'view', 'view_all'),
      ...actions('customer', 'view'),
      ...actions('supplier', 'view'),
      ...actions('purchase', 'view'),
      ...actions('commission', 'view', 'view_all', 'pay'),
      ...actions('product', 'view', 'view_cost'),
    ],
    maxDiscountPercent: 0,
  },
  {
    name: 'Production Staff',
    isOwner: false,
    permissions: actions('production', 'view', 'edit'),
    maxDiscountPercent: 0,
  },
  {
    name: 'AI/Automation Operator',
    isOwner: false,
    permissions: [
      ...actions('automation', 'view', 'configure'),
      ...actions('ai', 'use', 'control', 'view_logs'),
      ...actions('template', 'view', 'configure'),
      ...actions('conversation', 'view', 'view_all', 'reply', 'assign'),
    ],
    maxDiscountPercent: 0,
  },
  {
    name: 'Viewer',
    isOwner: false,
    permissions: (Object.keys(PERMISSION_CATALOGUE) as PermissionResource[])
      .filter((r) => r !== 'platform' && !FINANCIAL_RESOURCES.has(r))
      .filter((r) => (PERMISSION_CATALOGUE[r] as readonly string[]).includes('view'))
      .map((r) => `${r}:view` as Permission),
    maxDiscountPercent: 0,
  },
];
