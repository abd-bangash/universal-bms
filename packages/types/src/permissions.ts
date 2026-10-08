/**
 * The complete permission catalogue (design.md "Permission Catalogue"). Permissions are
 * `resource:action`. This is the only place they are defined; the role editor, the API guards
 * and the tests all read it.
 */
export const PERMISSION_CATALOGUE = {
  workspace: ['view', 'configure'],
  user: ['view', 'create', 'edit', 'deactivate'],
  role: ['view', 'configure'],
  audit: ['view', 'export'],
  field: ['view', 'configure'],
  workflow: ['view', 'configure'],
  product: ['view', 'create', 'edit', 'archive', 'export', 'view_cost'],
  inventory: ['view', 'adjust', 'transfer', 'count', 'approve', 'export'],
  supplier: ['view', 'create', 'edit', 'archive'],
  purchase: ['view', 'create', 'edit', 'receive', 'approve', 'return'],
  customer: ['view', 'create', 'edit', 'archive', 'merge', 'export', 'anonymize'],
  lead: ['view', 'view_all', 'create', 'edit', 'archive', 'assign', 'export'],
  task: ['view', 'view_all', 'create', 'edit'],
  conversation: ['view', 'view_all', 'reply', 'assign'],
  template: ['view', 'configure'],
  quotation: ['view', 'create', 'edit', 'archive', 'approve', 'send'],
  order: [
    'view',
    'view_all',
    'create',
    'edit',
    'cancel',
    'approve',
    'export',
    'price_override',
    'discount_override',
    'deposit_override',
    'complete_with_balance',
  ],
  production: ['view', 'view_all', 'edit', 'assign'],
  pos: [
    'sell',
    'open_session',
    'close_session',
    'cash_movement',
    'reprint',
    'refund',
    'view_all_sessions',
  ],
  payment: ['view', 'create', 'confirm', 'void', 'refund'],
  expense: ['view', 'create', 'void'],
  account: ['view', 'configure'],
  commission: ['view', 'view_all', 'approve', 'pay', 'configure'],
  report: ['view', 'financial', 'view_all_staff', 'export', 'build'],
  automation: ['view', 'configure'],
  ai: ['use', 'control', 'view_logs'],
  integration: ['view', 'manage'],
  import: ['run'],
  platform: ['admin'],
} as const;

export type PermissionResource = keyof typeof PERMISSION_CATALOGUE;

type ActionOf<R extends PermissionResource> = (typeof PERMISSION_CATALOGUE)[R][number];

export type Permission = {
  [R in PermissionResource]: `${R}:${ActionOf<R>}`;
}[PermissionResource];

/** `platform:admin` belongs to Platform_Admins and is never grantable inside a workspace. */
export const PLATFORM_ONLY_PERMISSIONS: readonly Permission[] = ['platform:admin'];

export const ALL_PERMISSIONS: readonly Permission[] = (
  Object.entries(PERMISSION_CATALOGUE) as Array<[PermissionResource, readonly string[]]>
).flatMap(([resource, actions]) => actions.map((action) => `${resource}:${action}` as Permission));

/** Every permission a workspace role may hold. */
export const WORKSPACE_PERMISSIONS: readonly Permission[] = ALL_PERMISSIONS.filter(
  (p) => !PLATFORM_ONLY_PERMISSIONS.includes(p),
);

const PERMISSION_SET: ReadonlySet<string> = new Set(ALL_PERMISSIONS);

export function isPermission(value: string): value is Permission {
  return PERMISSION_SET.has(value);
}
