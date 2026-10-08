import { z } from 'zod';

const termKeys = [
  'customer',
  'lead',
  'order',
  'quotation',
  'product',
  'variant',
  'salesperson',
  'supplier',
  'purchaseOrder',
  'location',
  'productionJob',
] as const;

const term = z.object({ singular: z.string().min(1), plural: z.string().min(1) });

export const conditionSchema: z.ZodType = z.lazy(() =>
  z.union([
    z
      .object({
        source: z.enum(['field', 'productType', 'categoryId', 'status']),
        key: z.string().optional(),
        op: z.enum(['eq', 'neq', 'in', 'gt', 'lt', 'exists']),
        value: z.unknown().optional(),
      })
      .strict(),
    z
      .object({
        all: z.array(conditionSchema).optional(),
        any: z.array(conditionSchema).optional(),
      })
      .strict(),
  ]),
);

const fieldDefinition = z.object({
  entityType: z.enum([
    'PRODUCT',
    'VARIANT',
    'ORDER_ITEM',
    'QUOTATION_ITEM',
    'CUSTOMER',
    'LEAD',
    'ORDER',
    'QUOTATION',
    'SUPPLIER',
    'PURCHASE_ORDER',
    'EXPENSE',
  ]),
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().min(1),
  type: z.enum([
    'TEXT',
    'NUMBER',
    'DATE',
    'BOOLEAN',
    'DROPDOWN',
    'MULTI_SELECT',
    'MEASUREMENT',
    'CURRENCY',
    'IMAGE',
    'REFERENCE',
  ]),
  unitDimension: z.enum(['length', 'area', 'weight', 'volume']).optional(),
  defaultUnit: z.string().optional(),
  options: z.array(z.object({ key: z.string().min(1), label: z.string().min(1) })).default([]),
  required: z.boolean().default(false),
  visibleWhen: conditionSchema.optional(),
  isVariantAxis: z.boolean().default(false),
  sortOrder: z.number().int().default(0),
});

const workflowState = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  label: z.string().min(1),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  category: z.enum(['OPEN', 'IN_PROGRESS', 'DONE', 'CANCELLED']),
  systemRole: z.string().optional(),
  isInitial: z.boolean().default(false),
});

const workflow = z
  .object({
    entityType: z.enum(['LEAD', 'ORDER', 'PURCHASE_ORDER', 'PRODUCTION_JOB']),
    name: z.string().min(1),
    states: z.array(workflowState).min(2),
    transitions: z.array(
      z.object({
        from: z.string(),
        to: z.string(),
        requiredPermission: z.string().optional(),
        requiredFields: z.array(z.string()).default([]),
        requiresApproval: z.boolean().default(false),
      }),
    ),
  })
  .superRefine((wf, ctx) => {
    const keys = new Set(wf.states.map((s) => s.key));
    if (keys.size !== wf.states.length)
      ctx.addIssue({ code: 'custom', message: 'duplicate state key' });
    if (wf.states.filter((s) => s.isInitial).length !== 1) {
      ctx.addIssue({ code: 'custom', message: 'exactly one initial state is required' });
    }
    for (const t of wf.transitions) {
      if (!keys.has(t.from) || !keys.has(t.to)) {
        ctx.addIssue({
          code: 'custom',
          message: `transition ${t.from} -> ${t.to} names an unknown state`,
        });
      }
    }
  });

const unit = z.object({
  name: z.string().min(1),
  symbol: z.string().min(1),
  dimension: z.enum(['count', 'weight', 'length', 'area', 'volume', 'time']),
  toBase: z.string().regex(/^\d+(\.\d+)?$/),
});

/** The `definition` JSON of an IndustryProfile row (design.md "Industry Profiles"). */
export const industryProfileSchema = z.object({
  key: z.string().regex(/^[a-z][a-z0-9_]*$/),
  name: z.string().min(1),
  terminology: z.record(z.enum(termKeys), term),
  modules: z.record(z.string(), z.boolean()),
  /** Partial WorkspaceConfig values applied when a workspace is first created on this profile. */
  configDefaults: z.record(z.string(), z.unknown()).default({}),
  fieldDefinitions: z.array(fieldDefinition),
  workflows: z.array(workflow),
  units: z.array(unit),
  categories: z.array(
    z.object({ name: z.string().min(1), children: z.array(z.string()).default([]) }),
  ),
  questionFlow: z.array(
    z.object({ key: z.string(), question: z.string(), fieldKey: z.string().optional() }),
  ),
  dashboardKpis: z.array(z.string()),
  lostReasons: z.array(z.string()),
  expenseCategories: z.array(z.string()),
});

export type IndustryProfileDefinition = z.infer<typeof industryProfileSchema>;
