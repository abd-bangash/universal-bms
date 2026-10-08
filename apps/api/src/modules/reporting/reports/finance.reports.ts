import { Prisma } from '@prisma/client';
import type { ReportColumn, ReportContext, ReportDefinition } from '../reporting.types';
import { asRows, purchaseNotDraftOrCancelled, query } from './report-sql';

const dp = (ctx: ReportContext) => ctx.currencyDecimals;
const money = (key: string, label: string, total = true): ReportColumn => ({
  key,
  label,
  type: 'money',
  financial: true,
  total,
});
const stamp = (column: string, ctx: ReportContext) =>
  Prisma.sql`to_char((${Prisma.raw(column)} AT TIME ZONE 'UTC') AT TIME ZONE ${ctx.timezone}, 'YYYY-MM-DD')`;

const commissionsFrom = (ctx: ReportContext) => {
  const scope = ctx.user.permissions.includes('commission:view_all')
    ? Prisma.empty
    : Prisma.sql`AND c.salesperson_id = ${ctx.user.userId}`;
  return Prisma.sql`
    FROM commissions c
    JOIN orders o ON o.id = c.order_id
    JOIN users u ON u.id = c.salesperson_id
    WHERE c.workspace_id = ${ctx.workspaceId} AND c.created_at >= ${ctx.start} AND c.created_at < ${ctx.end} ${scope}
      ${ctx.query.salespersonId ? Prisma.sql`AND c.salesperson_id = ${ctx.query.salespersonId}` : Prisma.empty}
      ${ctx.query.status ? Prisma.sql`AND c.status::text = ${ctx.query.status}` : Prisma.empty}`;
};

const COMMISSION_COLUMNS: ReportColumn[] = [
  { key: 'date', label: 'Date', type: 'date' },
  { key: 'salesperson', label: 'Salesperson', type: 'text' },
  { key: 'orderNumber', label: 'Order', type: 'text', link: 'order:orderId' },
  { key: 'rule', label: 'Rule', type: 'text' },
  money('base', 'Sales base', false),
  { key: 'share', label: 'Share (%)', type: 'percent' },
  money('amount', 'Commission'),
  { key: 'status', label: 'Status', type: 'text' },
];

export const commissionStatement: ReportDefinition = {
  key: 'commission-statement',
  title: 'Commission statement',
  description: 'Commissions earned in the period, by salesperson and status.',
  requires: ['commission:view'],
  financial: true,
  filters: [
    { key: 'range', label: 'Dates' },
    { key: 'salespersonId', label: 'Salesperson' },
    { key: 'status', label: 'Status' },
  ],
  columns: COMMISSION_COLUMNS,
  reconciles: [{ column: 'amount', drillColumn: 'amount' }],
  async query(ctx) {
    return asRows(await commissionRows(ctx, Prisma.empty));
  },
  async drilldown(ctx) {
    const row = ctx.query.row ? Prisma.sql`AND c.id = ${ctx.query.row}` : Prisma.empty;
    return { columns: COMMISSION_COLUMNS, rows: asRows(await commissionRows(ctx, row)) };
  },
};

function commissionRows(ctx: ReportContext, extra: Prisma.Sql) {
  return query<Record<string, unknown>>(
    ctx,
    Prisma.sql`
      SELECT c.id AS key, ${stamp('c.created_at', ctx)} AS date, u.first_name || ' ' || u.last_name AS salesperson,
        o.id AS "orderId", o.order_number AS "orderNumber", COALESCE(c.rule_snapshot ->> 'name', '') AS rule,
        ROUND(c.calculation_base, ${dp(ctx)}::int)::text AS base, c.share_percent::float8 AS share,
        ROUND(c.amount, ${dp(ctx)}::int)::text AS amount, c.status::text AS status
      ${commissionsFrom(ctx)} ${extra} ORDER BY c.created_at, c.id LIMIT ${ctx.limit + 1}`,
  );
}

const expensesFrom = (ctx: ReportContext) => Prisma.sql`
  FROM expenses e JOIN expense_categories cat ON cat.id = e.category_id
  LEFT JOIN payment_methods m ON m.id = e.payment_method_id
  WHERE e.workspace_id = ${ctx.workspaceId} AND e.status = 'POSTED'
    AND e.expense_date >= ${ctx.start} AND e.expense_date < ${ctx.end}`;

export const expensesReport: ReportDefinition = {
  key: 'expenses',
  title: 'Expenses',
  description: 'Money spent in the period by expense category (voided expenses are left out).',
  requires: ['expense:view'],
  financial: true,
  filters: [{ key: 'range', label: 'Dates' }],
  columns: [
    { key: 'category', label: 'Category', type: 'text' },
    { key: 'expenses', label: 'Expenses', type: 'number', total: true },
    money('amount', 'Amount'),
  ],
  reconciles: [{ column: 'amount', drillColumn: 'amount' }],
  async query(ctx) {
    return asRows(
      await query<Record<string, unknown>>(
        ctx,
        Prisma.sql`
          SELECT e.category_id AS key, MAX(cat.name) AS category, COUNT(*)::int AS expenses,
            ROUND(SUM(e.amount), ${dp(ctx)}::int)::text AS amount
          ${expensesFrom(ctx)} GROUP BY e.category_id ORDER BY SUM(e.amount) DESC, 2`,
      ),
    );
  },
  async drilldown(ctx) {
    const row = ctx.query.row ? Prisma.sql`AND e.category_id = ${ctx.query.row}` : Prisma.empty;
    return {
      columns: [
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'category', label: 'Category', type: 'text' },
        { key: 'description', label: 'Description', type: 'text' },
        { key: 'method', label: 'Payment method', type: 'text' },
        money('amount', 'Amount'),
      ],
      rows: asRows(
        await query<Record<string, unknown>>(
          ctx,
          Prisma.sql`
            SELECT e.id AS key, ${stamp('e.expense_date', ctx)} AS date, cat.name AS category,
              COALESCE(e.description, '') AS description, COALESCE(m.name, '') AS method,
              ROUND(e.amount, ${dp(ctx)}::int)::text AS amount
            ${expensesFrom(ctx)} ${row} ORDER BY e.expense_date, e.id`,
        ),
      ),
    };
  },
};

/** Purchase orders placed in the period that are not drafts or cancelled, with the value received so far. */
const purchasesFrom = (ctx: ReportContext) => Prisma.sql`
  FROM purchase_orders po JOIN suppliers s ON s.id = po.supplier_id
  WHERE po.workspace_id = ${ctx.workspaceId} AND ${purchaseNotDraftOrCancelled}
    AND po.order_date >= ${ctx.start} AND po.order_date < ${ctx.end}`;

const receivedValue = Prisma.sql`
  (SELECT COALESCE(SUM(i.received_qty * i.unit_cost), 0) FROM purchase_order_items i WHERE i.purchase_order_id = po.id)`;

export const purchasesReport: ReportDefinition = {
  key: 'purchases',
  title: 'Purchases',
  description: 'What was ordered from each supplier in the period, and how much has arrived.',
  requires: ['purchase:view'],
  financial: true,
  filters: [{ key: 'range', label: 'Dates' }],
  columns: [
    { key: 'supplier', label: 'Supplier', type: 'text' },
    { key: 'orders', label: 'Orders', type: 'number', total: true },
    money('ordered', 'Ordered'),
    money('received', 'Received'),
  ],
  reconciles: [
    { column: 'ordered', drillColumn: 'ordered' },
    { column: 'received', drillColumn: 'received' },
  ],
  async query(ctx) {
    return asRows(
      await query<Record<string, unknown>>(
        ctx,
        Prisma.sql`
          SELECT po.supplier_id AS key, MAX(s.name) AS supplier, COUNT(*)::int AS orders,
            ROUND(SUM(po.total_amount), ${dp(ctx)}::int)::text AS ordered,
            SUM(ROUND(${receivedValue}, ${dp(ctx)}::int))::text AS received
          ${purchasesFrom(ctx)} GROUP BY po.supplier_id ORDER BY SUM(po.total_amount) DESC, 2`,
      ),
    );
  },
  async drilldown(ctx) {
    const row = ctx.query.row ? Prisma.sql`AND po.supplier_id = ${ctx.query.row}` : Prisma.empty;
    return {
      columns: [
        { key: 'orderNumber', label: 'Purchase order', type: 'text', link: 'purchase:purchaseId' },
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'supplier', label: 'Supplier', type: 'text' },
        { key: 'status', label: 'Status', type: 'text' },
        money('ordered', 'Ordered'),
        money('received', 'Received'),
      ],
      rows: asRows(
        await query<Record<string, unknown>>(
          ctx,
          Prisma.sql`
            SELECT po.id AS key, po.id AS "purchaseId", po.order_number AS "orderNumber",
              ${stamp('po.order_date', ctx)} AS date, s.name AS supplier, po.status,
              ROUND(po.total_amount, ${dp(ctx)}::int)::text AS ordered,
              ROUND(${receivedValue}, ${dp(ctx)}::int)::text AS received
            ${purchasesFrom(ctx)} ${row} ORDER BY po.order_date, po.order_number`,
        ),
      ),
    };
  },
};

export const FINANCE_REPORTS: ReportDefinition[] = [
  commissionStatement,
  expensesReport,
  purchasesReport,
];
