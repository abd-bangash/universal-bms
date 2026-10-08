import { DEFAULT_ROLES, MODULE_KEYS, isPermission } from '@bms/types';
import {
  NAVIGATION,
  NAVIGATION_PERMISSIONS,
  visibleNavigation,
  type NavigationEntry,
} from './navigation';

describe('navigation registry', () => {
  it('is well formed: unique keys and paths, real permissions and modules', () => {
    expect(new Set(NAVIGATION.map((e) => e.key)).size).toBe(NAVIGATION.length);
    expect(new Set(NAVIGATION.map((e) => e.href)).size).toBe(NAVIGATION.length);
    for (const entry of NAVIGATION) {
      expect(entry.href.startsWith('/')).toBe(true);
      for (const p of entry.permissions) expect(isPermission(p)).toBe(true);
      if (entry.module) expect(MODULE_KEYS).toContain(entry.module);
    }
    expect(NAVIGATION_PERMISSIONS.length).toBeGreaterThan(10);
  });

  it('covers the application areas of Requirement 49.1', () => {
    const areas = new Set(NAVIGATION.map((e) => e.area));
    for (const area of [
      'home',
      'crm',
      'sales',
      'pos',
      'products',
      'inventory',
      'purchasing',
      'finance',
      'staff',
      'automation',
      'integrations',
      'reports',
      'settings',
    ]) {
      expect(areas).toContain(area);
    }
  });
});

describe('visibleNavigation (Requirement 49.2)', () => {
  const entries: NavigationEntry[] = [
    {
      key: 'home',
      href: '/',
      label: { message: 'home' },
      area: 'home',
      permissions: [],
      available: true,
    },
    {
      key: 'orders',
      href: '/orders',
      label: { term: 'order' },
      area: 'sales',
      permissions: ['order:view'],
      available: true,
    },
    {
      key: 'pos',
      href: '/pos',
      label: { message: 'pos' },
      area: 'pos',
      permissions: ['pos:sell'],
      module: 'pos',
      available: true,
    },
    {
      key: 'ai',
      href: '/ai',
      label: { message: 'automation' },
      area: 'automation',
      permissions: ['ai:use', 'automation:view'],
      available: true,
    },
    {
      key: 'later',
      href: '/later',
      label: { message: 'reports' },
      area: 'reports',
      permissions: [],
      available: false,
    },
  ];
  const keys = (permissions: string[], modules: Record<string, boolean> = {}) =>
    visibleNavigation(entries, { permissions, modules }).map((e) => e.key);

  it('shows only what the permissions allow, and always the permission-free entries', () => {
    expect(keys([])).toEqual(['home']);
    expect(keys(['order:view'])).toEqual(['home', 'orders']);
  });

  it('shows an entry when ANY of its permissions is held', () => {
    expect(keys(['automation:view'])).toEqual(['home', 'ai']);
    expect(keys(['ai:use'])).toEqual(['home', 'ai']);
  });

  it('hides entries of a module the workspace switched off, even for permitted users', () => {
    expect(keys(['pos:sell'], { pos: false })).toEqual(['home']);
    expect(keys(['pos:sell'], {})).toEqual(['home']);
    expect(keys(['pos:sell'], { pos: true })).toEqual(['home', 'pos']);
  });

  it('hides screens that do not exist yet', () => {
    expect(keys(['order:view'])).not.toContain('later');
  });
});

describe('navigation per default role (checkpoint 16)', () => {
  const allModules = Object.fromEntries(MODULE_KEYS.map((k) => [k, true]));

  it('shows every role only entries its permissions allow, and Owner the most', () => {
    const counts = new Map<string, number>();
    for (const role of DEFAULT_ROLES) {
      const entries = visibleNavigation(NAVIGATION, {
        permissions: role.permissions,
        modules: allModules,
      });
      counts.set(role.name, entries.length);
      for (const entry of entries) {
        if (entry.permissions.length > 0) {
          expect(entry.permissions.some((p) => role.permissions.includes(p))).toBe(true);
        }
      }
    }
    const owner = counts.get('Owner') as number;
    for (const [name, n] of counts) {
      if (name !== 'Owner') expect(n).toBeLessThanOrEqual(owner);
    }
  });
});
