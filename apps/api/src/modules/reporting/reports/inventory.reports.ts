import { Prisma } from '@prisma/client';
import type { ReportColumn, ReportContext, ReportDefinition } from '../reporting.types';
import { asRows, query } from './report-sql';

const dp = (ctx: ReportContext) => ctx.currencyDecimals;
const LOCATION = { key: 'locationId', label: 'Location' } as const;
const CATEGORY = { key: 'categoryId', label: 'Category' } as const;

const levelsFrom = (ctx: ReportContext) => Prisma.sql`
  FROM stock_levels l
  JOIN product_variants v ON v.id = l.variant_id
  JOIN products p ON p.id = v.product_id
  JOIN inventory_locations loc ON loc.id = l.location_id
  WHERE l.workspace_id = ${ctx.workspaceId}
    ${ctx.query.locationId ? Prisma.sql`AND l.location_id = ${ctx.query.locationId}` : Prisma.empty}
    ${ctx.query.categoryId ? Prisma.sql`AND p.category_id = ${ctx.query.categoryId}` : Prisma.empty}`;

const itemName = Prisma.sql`CASE WHEN v.name IS NULL THEN p.name ELSE p.name || ' · ' || v.name END`;

const LEDGER_COLUMNS: ReportColumn[] = [
  { key: 'date', label: 'When', type: 'datetime' },
  { key: 'type', label: 'Type', type: 'text' },
  { key: 'item', label: 'Item', type: 'text' },
  { key: 'location', label: 'Location', type: 'text' },
  { key: 'quantity', label: 'Quantity', type: 'number', total: true },
  { key: 'unitCost', label: 'Unit cost', type: 'money', financial: true },
  { key: 'reference', label: 'Reference', type: 'text' },
  { key: 'note', label: 'Note', type: 'text' },
];

function movements(ctx: ReportContext, where: Prisma.Sql, limit?: number) {
  return query<Record<string, unknown>>(
    ctx,
    Prisma.sql`
      SELECT m.id AS key, to_char((m.created_at AT TIME ZONE 'UTC') AT TIME ZONE ${ctx.timezone}, 'YYYY-MM-DD HH24:MI') AS date,
        m.movement_type::text AS type, ${itemName} AS item, loc.name AS location,
        m.quantity_delta::float8 AS quantity,
        ROUND(m.unit_cost, ${dp(ctx)}::int)::text AS "unitCost",
        COALESCE(m.reference_type, '') AS reference, COALESCE(m.note, '') AS note
      FROM stock_movements m
      JOIN product_variants v ON v.id = m.variant_id
      JOIN products p ON p.id = v.product_id
      JOIN inventory_locations loc ON loc.id = m.location_id
      WHERE m.workspace_id = ${ctx.workspaceId} AND ${where}
      ORDER BY m.created_at, m.id ${limit ? Prisma.sql`LIMIT ${limit}` : Prisma.empty}`,
  );
}

/** The ledger entries that add up to one stock level: variant and location are in the row key. */
async function ledgerOf(ctx: ReportContext) {
  const [variantId, locationId] = (ctx.query.row ?? '').split('|');
  const where =
    variantId && locationId
      ? Prisma.sql`m.variant_id = ${variantId} AND m.location_id = ${locationId}`
      : Prisma.sql`(m.variant_id, m.location_id) IN (SELECT l.variant_id, l.location_id ${levelsFrom(ctx)} ${lowOnly(ctx)})`;
  return { columns: LEDGER_COLUMNS, rows: asRows(await movements(ctx, where)) };
}

const lowOnly = (ctx: ReportContext) =>
  ctx.query.status === 'low'
    ? Prisma.sql`AND v.min_stock_level IS NOT NULL AND l.on_hand - l.reserved < v.min_stock_level`
    : Prisma.empty;

const STOCK_COLUMNS: ReportColumn[] = [
  { key: 'sku', label: 'SKU', type: 'text' },
  { key: 'item', label: 'Item', type: 'text' },
  { key: 'location', label: 'Location', type: 'text' },
  { key: 'onHand', label: 'On hand', type: 'number', total: true },
  { key: 'reserved', label: 'Reserved', type: 'number', total: true },
  { key: 'available', label: 'Available', type: 'number', total: true },
];

export const stockOnHand: ReportDefinition = {
  key: 'stock-on-hand',
  title: 'Stock on hand',
  description: 'What is in stock now, where, and what it is worth at average cost.',
  requires: ['inventory:view'],
  financial: false,
  filters: [LOCATION, CATEGORY],
  columns: [
    ...STOCK_COLUMNS,
    { key: 'avgCost', label: 'Average cost', type: 'money', financial: true },
    { key: 'stockValue', label: 'Stock value', type: 'money', financial: true, total: true },
  ],
  reconciles: [{ column: 'onHand', drillColumn: 'quantity' }],
  async query(ctx) {
    return asRows(
      await query<Record<string, unknown>>(
        ctx,
        Prisma.sql`
          SELECT l.variant_id || '|' || l.location_id AS key, v.sku, ${itemName} AS item, loc.name AS location,
            l.on_hand::float8 AS "onHand", l.reserved::float8 AS reserved,
            (l.on_hand - l.reserved)::float8 AS available,
            ROUND(l.avg_cost, ${dp(ctx)}::int)::text AS "avgCost",
            ROUND(l.on_hand * l.avg_cost, ${dp(ctx)}::int)::text AS "stockValue"
          ${levelsFrom(ctx)} AND (l.on_hand <> 0 OR l.reserved <> 0)
          ORDER BY p.name, v.sku, loc.name`,
      ),
    );
  },
  async drilldown(ctx) {
    return ledgerOf(ctx);
  },
};

export const lowStock: ReportDefinition = {
  key: 'low-stock',
  title: 'Low stock',
  description: 'Items whose available stock is below their minimum level.',
  requires: ['inventory:view'],
  financial: false,
  filters: [LOCATION, CATEGORY],
  columns: [
    ...STOCK_COLUMNS,
    { key: 'minLevel', label: 'Minimum', type: 'number' },
    { key: 'shortfall', label: 'Short by', type: 'number', total: true },
  ],
  reconciles: [{ column: 'onHand', drillColumn: 'quantity' }],
  async query(ctx) {
    return asRows(
      await query<Record<string, unknown>>(
        ctx,
        Prisma.sql`
          SELECT l.variant_id || '|' || l.location_id AS key, v.sku, ${itemName} AS item, loc.name AS location,
            l.on_hand::float8 AS "onHand", l.reserved::float8 AS reserved,
            (l.on_hand - l.reserved)::float8 AS available, v.min_stock_level::float8 AS "minLevel",
            (v.min_stock_level - (l.on_hand - l.reserved))::float8 AS shortfall
          ${levelsFrom(ctx)} AND v.min_stock_level IS NOT NULL AND l.on_hand - l.reserved < v.min_stock_level
            AND v.status = 'ACTIVE'
          ORDER BY (v.min_stock_level - (l.on_hand - l.reserved)) DESC, v.sku`,
      ),
    );
  },
  async drilldown(ctx) {
    return ledgerOf({ ...ctx, query: { ...ctx.query, status: 'low' } });
  },
};

export const stockMovements: ReportDefinition = {
  key: 'stock-movements',
  title: 'Stock movements',
  description: 'The stock ledger for the period: every addition and removal.',
  requires: ['inventory:view'],
  financial: false,
  filters: [{ key: 'range', label: 'Dates' }, LOCATION, { key: 'status', label: 'Type' }],
  columns: LEDGER_COLUMNS,
  reconciles: [{ column: 'quantity', drillColumn: 'quantity' }],
  async query(ctx) {
    return asRows(await movements(ctx, movementWhere(ctx), ctx.limit + 1));
  },
  async drilldown(ctx) {
    const row = ctx.query.row ? Prisma.sql`AND m.id = ${ctx.query.row}` : Prisma.empty;
    return {
      columns: LEDGER_COLUMNS,
      rows: asRows(await movements(ctx, Prisma.sql`${movementWhere(ctx)} ${row}`, ctx.limit + 1)),
    };
  },
};

const movementWhere = (
  ctx: ReportContext,
) => Prisma.sql`m.created_at >= ${ctx.start} AND m.created_at < ${ctx.end}
  ${ctx.query.locationId ? Prisma.sql`AND m.location_id = ${ctx.query.locationId}` : Prisma.empty}
  ${ctx.query.status ? Prisma.sql`AND m.movement_type::text = ${ctx.query.status}` : Prisma.empty}`;

export const INVENTORY_REPORTS: ReportDefinition[] = [stockOnHand, lowStock, stockMovements];
