import { ALL_PERMISSIONS, DEFAULT_ROLES, WORKSPACE_PERMISSIONS, isPermission } from '@bms/types';
import { loadBuiltInProfiles } from '../industry-profile.loader';
import { createDefaultConfig, mergeConfig } from '../default-config';

describe('DEFAULT_ROLES (Requirement 2.8)', () => {
  const byName = Object.fromEntries(DEFAULT_ROLES.map((r) => [r.name, r]));

  it('defines the nine system roles with their discount limits', () => {
    expect(DEFAULT_ROLES.map((r) => r.name)).toEqual([
      'Owner',
      'Manager',
      'Salesperson',
      'Cashier',
      'Inventory Staff',
      'Account Staff',
      'Production Staff',
      'AI/Automation Operator',
      'Viewer',
    ]);
    expect(DEFAULT_ROLES.map((r) => r.maxDiscountPercent)).toEqual([100, 20, 5, 0, 0, 0, 0, 0, 0]);
  });

  it('only uses permissions from the catalogue, and never platform:admin', () => {
    for (const role of DEFAULT_ROLES) {
      expect(role.permissions.every((p) => isPermission(p))).toBe(true);
      expect(role.permissions).not.toContain('platform:admin');
      expect(new Set(role.permissions).size).toBe(role.permissions.length);
    }
  });

  it('Owner has every workspace permission; Manager lacks exactly the configuration ones', () => {
    expect(byName.Owner?.permissions).toEqual(WORKSPACE_PERMISSIONS);
    const missing = WORKSPACE_PERMISSIONS.filter((p) => !byName.Manager?.permissions.includes(p));
    expect(missing.sort()).toEqual(
      [
        'account:configure',
        'field:configure',
        'integration:manage',
        'role:configure',
        'workflow:configure',
        'workspace:configure',
      ].sort(),
    );
  });

  it('least privilege: Cashier, Production Staff and Viewer cannot see financial data or costs', () => {
    const sensitive = [
      'payment:void',
      'payment:refund',
      'report:financial',
      'product:view_cost',
      'expense:view',
      'account:view',
    ];
    for (const name of [
      'Cashier',
      'Production Staff',
      'Viewer',
      'Salesperson',
      'Inventory Staff',
    ]) {
      for (const p of sensitive) expect(byName[name]?.permissions).not.toContain(p);
    }
    expect(byName.Viewer?.permissions.every((p) => p.endsWith(':view'))).toBe(true);
    expect(byName.Viewer?.permissions).not.toContain('payment:view');
    // nor the audit trail (personal data in its changes) or the state of the outside connections
    expect(byName.Viewer?.permissions).not.toContain('audit:view');
    expect(byName.Viewer?.permissions).not.toContain('integration:view');
  });

  it('Account Staff holds financial access; Salesperson cannot override prices or approve', () => {
    expect(byName['Account Staff']?.permissions).toEqual(
      expect.arrayContaining(['payment:void', 'report:financial', 'product:view_cost']),
    );
    for (const p of [
      'order:price_override',
      'order:approve',
      'quotation:approve',
      'order:cancel',
    ]) {
      expect(byName.Salesperson?.permissions).not.toContain(p);
    }
  });

  it('is covered by the catalogue', () => {
    const used = new Set(DEFAULT_ROLES.flatMap((r) => r.permissions));
    for (const p of used) expect(ALL_PERMISSIONS).toContain(p);
  });
});

describe('built-in industry profiles', () => {
  const profiles = loadBuiltInProfiles();
  const furniture = profiles.get('furniture');

  it('ships a valid furniture profile', () => {
    expect(furniture?.name).toBe('Furniture');
  });

  it('defines the furniture line attributes on order lines, quotation lines and leads (design.md)', () => {
    for (const entity of ['ORDER_ITEM', 'QUOTATION_ITEM', 'LEAD']) {
      const keys = furniture?.fieldDefinitions
        .filter((f) => f.entityType === entity)
        .map((f) => f.key);
      expect(keys).toEqual([
        'size_type',
        'length',
        'width',
        'height',
        'area',
        'material',
        'fabric',
        'wood_type',
        'color',
        'design',
        'reference_image',
        'customization_notes',
        'estimated_production_days',
      ]);
    }
    const length = furniture?.fieldDefinitions.find(
      (f) => f.entityType === 'ORDER_ITEM' && f.key === 'length',
    );
    expect(length).toMatchObject({
      type: 'MEASUREMENT',
      unitDimension: 'length',
      visibleWhen: { op: 'eq', value: 'custom' },
    });
  });

  it('defines the standard product attributes (Requirement 6.4) and variant axes with options', () => {
    const product = furniture?.fieldDefinitions
      .filter((f) => f.entityType === 'PRODUCT')
      .map((f) => f.key);
    expect(product).toEqual(['width', 'depth', 'height', 'material', 'color', 'finish']);
    const axes = furniture?.fieldDefinitions.filter((f) => f.isVariantAxis) ?? [];
    expect(axes.length).toBeGreaterThan(0);
    for (const axis of axes) expect(axis.options.length).toBeGreaterThan(1);
  });

  it('has the four workflows with the required system roles (Requirement 27.4) and sound transitions', () => {
    const required: Record<string, string[]> = {
      ORDER: ['DRAFT', 'CONFIRMED', 'DELIVERED', 'COMPLETED', 'CANCELLED'],
      LEAD: ['NEW', 'WON', 'LOST'],
      PURCHASE_ORDER: ['DRAFT', 'SENT', 'PARTIALLY_RECEIVED', 'RECEIVED', 'CANCELLED'],
      PRODUCTION_JOB: ['QUEUED', 'DONE'],
    };
    expect(furniture?.workflows.map((w) => w.entityType).sort()).toEqual(
      Object.keys(required).sort(),
    );
    for (const wf of furniture?.workflows ?? []) {
      const roles = wf.states.map((s) => s.systemRole).filter(Boolean);
      expect(roles).toEqual(expect.arrayContaining(required[wf.entityType] as string[]));
      expect(new Set(roles).size).toBe(roles.length); // a system role appears once
      const terminal = wf.states
        .filter((s) => s.category === 'DONE' || s.category === 'CANCELLED')
        .map((s) => s.key);
      for (const t of wf.transitions) {
        if (wf.entityType === 'PURCHASE_ORDER' || wf.entityType === 'PRODUCTION_JOB') continue;
        expect(terminal).not.toContain(t.from); // nothing leaves a closed state
      }
      const reachable = new Set(wf.states.filter((s) => s.isInitial).map((s) => s.key));
      for (let i = 0; i < wf.states.length; i++) {
        for (const t of wf.transitions) if (reachable.has(t.from)) reachable.add(t.to);
      }
      expect([...reachable].sort()).toEqual(wf.states.map((s) => s.key).sort()); // every state is reachable
    }
  });

  it('follows the default order lifecycle of design.md', () => {
    const order = furniture?.workflows.find((w) => w.entityType === 'ORDER');
    expect(order?.states.map((s) => s.key)).toEqual([
      'draft',
      'confirmed',
      'deposit_paid',
      'in_production',
      'ready',
      'out_for_delivery',
      'delivered',
      'completed',
      'on_hold',
      'cancelled',
    ]);
    const can = (from: string, to: string) =>
      order?.transitions.some((t) => t.from === from && t.to === to);
    for (const state of [
      'draft',
      'confirmed',
      'deposit_paid',
      'in_production',
      'ready',
      'out_for_delivery',
      'delivered',
      'on_hold',
    ]) {
      expect(can(state, 'cancelled')).toBe(true);
    }
    for (const state of [
      'draft',
      'confirmed',
      'deposit_paid',
      'in_production',
      'ready',
      'out_for_delivery',
      'delivered',
    ]) {
      expect(can(state, 'on_hold')).toBe(true);
    }
    expect(can('completed', 'cancelled')).toBe(false);
    expect(order?.transitions.find((t) => t.to === 'cancelled')?.requiredPermission).toBe(
      'order:cancel',
    );
  });

  it('has units of every dimension used by furniture and non-empty reference lists', () => {
    expect(new Set(furniture?.units.map((u) => u.dimension))).toEqual(
      new Set(['count', 'length', 'area', 'weight']),
    );
    for (const dim of ['length', 'area', 'weight']) {
      expect(furniture?.units.filter((u) => u.dimension === dim && u.toBase === '1')).toHaveLength(
        1,
      );
    }
    expect(furniture?.lostReasons.length).toBeGreaterThan(3);
    expect(furniture?.expenseCategories.length).toBeGreaterThan(3);
    expect(furniture?.categories.length).toBeGreaterThanOrEqual(6);
  });
});

describe('default workspace config', () => {
  it('covers every document type and keeps automation and AI off', () => {
    const config = createDefaultConfig({
      legalName: 'Acme',
      currency: 'PKR',
      timezone: 'Asia/Karachi',
    });
    expect(Object.keys(config.numbering)).toHaveLength(9);
    expect(config.locale).toMatchObject({
      currency: 'PKR',
      timezone: 'Asia/Karachi',
      currencyDecimals: 2,
    });
    expect(config.ai.mode).toBe('OFF');
    expect(config.messaging.automationEnabled).toBe(false);
    expect(config.inventory.allowNegativeStock).toBe(false);
    expect(config.business.legalName).toBe('Acme');
  });

  it('mergeConfig deep merges objects, replaces scalars and does not mutate the base', () => {
    const base = createDefaultConfig({ legalName: 'A' });
    const merged = mergeConfig(base, {
      sales: { requiredDepositPercent: 50 },
      ai: { escalationKeywords: ['x'] },
    });
    expect(merged.sales).toMatchObject({ requiredDepositPercent: 50, discountOverLimit: 'REJECT' });
    expect(merged.ai.escalationKeywords).toEqual(['x']);
    expect(base.sales.requiredDepositPercent).toBe(0);
  });
});
