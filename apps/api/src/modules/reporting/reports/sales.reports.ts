import { Prisma } from '@prisma/client';
import type { ReportColumn, ReportContext, ReportDefinition } from '../reporting.types';
import { asRows, orderNotDraftOrCancelled, orderScope, query, salesOrders } from './report-sql';

const RANGE = { key: 'range', label: 'Dates' } as const;
const PERSON = { key: 'salespersonId', label: 'Salesperson' } as const;
const dp = (ctx: ReportContext) => ctx.currencyDecimals;
const day = (ctx: ReportContext) =>
  Prisma.sql`to_char((o.order_date AT TIME ZONE 'UTC') AT TIME ZONE ${ctx.timezone}, 'YYYY-MM-DD')`;

const money = (key: string, label: string, extra: Partial<ReportColumn> = {}): ReportColumn => ({
  key,
  label,
  type: 'money',
  financial: true,
  total: true,
  ...extra,
});

/** The orders behind a figure, one row per order. Shared by the drill-downs that end at an order. */
const ORDER_COLUMNS: ReportColumn[] = [
  { key: 'orderNumber', label: 'Order', type: 'text', link: 'order:orderId' },
  { key: 'date', label: 'Date', type: 'date' },
  { key: 'customer', label: 'Customer', type: 'text' },
  { key: 'status', label: 'Status', type: 'text' },
  money('subtotal', 'Subtotal'),
  money('discounts', 'Discounts'),
  money('tax', 'Tax'),
  money('total', 'Total'),
];

function orderRows(ctx: ReportContext, where: Prisma.Sql) {
  return query<Record<string, unknown>>(
    ctx,
    Prisma.sql`
      SELECT o.id AS key, o.id AS "orderId", o.order_number AS "orderNumber", ${day(ctx)} AS date,
        c.full_name AS customer, o.status,
        ROUND(o.subtotal, ${dp(ctx)}::int)::text AS subtotal,
        ROUND(o.discount_amount, ${dp(ctx)}::int)::text AS discounts,
        ROUND(o.tax_amount, ${dp(ctx)}::int)::text AS tax,
        ROUND(o.total_amount, ${dp(ctx)}::int)::text AS total
      FROM orders o JOIN customers c ON c.id = o.customer_id
      WHERE ${where}
      ORDER BY o.order_date, o.order_number`,
  );
}

export const salesByDate: ReportDefinition = {
  key: 'sales-by-date',
  title: 'Sales by date',
  description: 'Orders that are not drafts or cancelled, by the day they were placed.',
  requires: ['order:view'],
  financial: true,
  filters: [RANGE, PERSON],
  columns: [
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'orders', label: 'Orders', type: 'number', total: true },
    money('subtotal', 'Subtotal'),
    money('discounts', 'Discounts'),
    money('tax', 'Tax'),
    money('total', 'Total'),
  ],
  reconciles: [{ column: 'total', drillColumn: 'total' }],
  async query(ctx) {
    const rows = await query<Record<string, unknown>>(
      ctx,
      Prisma.sql`
        SELECT d AS key, d AS date, COUNT(*)::int AS orders,
          ROUND(SUM(subtotal), ${dp(ctx)}::int)::text AS subtotal,
          ROUND(SUM(discount_amount), ${dp(ctx)}::int)::text AS discounts,
          ROUND(SUM(tax_amount), ${dp(ctx)}::int)::text AS tax,
          ROUND(SUM(total_amount), ${dp(ctx)}::int)::text AS total
        FROM (
          SELECT ${day(ctx)} AS d, o.subtotal, o.discount_amount, o.tax_amount, o.total_amount
          FROM orders o WHERE ${salesOrders(ctx)}
        ) x GROUP BY d ORDER BY d`,
    );
    return asRows(rows);
  },
  async drilldown(ctx) {
    const row = ctx.query.row ? Prisma.sql`AND ${day(ctx)} = ${ctx.query.row}` : Prisma.empty;
    return {
      columns: ORDER_COLUMNS,
      rows: asRows(await orderRows(ctx, Prisma.sql`${salesOrders(ctx)} ${row}`)),
    };
  },
};

const LINE_COLUMNS: ReportColumn[] = [
  { key: 'orderNumber', label: 'Order', type: 'text', link: 'order:orderId' },
  { key: 'date', label: 'Date', type: 'date' },
  { key: 'item', label: 'Item', type: 'text' },
  { key: 'quantity', label: 'Quantity', type: 'number', total: true },
  money('discounts', 'Discounts'),
  money('net', 'Net sales'),
];

/** Order lines of sales, with the product and category they belong to. */
const linesFrom = (ctx: ReportContext) => Prisma.sql`
  FROM order_items i
  JOIN orders o ON o.id = i.order_id
  LEFT JOIN products p ON p.id = i.product_id
  LEFT JOIN categories cat ON cat.id = p.category_id
  WHERE ${salesOrders(ctx)}
    ${ctx.query.categoryId ? Prisma.sql`AND p.category_id = ${ctx.query.categoryId}` : Prisma.empty}`;

function lineRows(ctx: ReportContext, extra: Prisma.Sql) {
  return query<Record<string, unknown>>(
    ctx,
    Prisma.sql`
      SELECT i.id AS key, i.order_id AS "orderId", o.order_number AS "orderNumber", ${day(ctx)} AS date,
        i.name AS item, i.quantity::float8 AS quantity,
        ROUND(i.discount_amount, ${dp(ctx)}::int)::text AS discounts,
        ROUND(i.line_total - i.tax_amount, ${dp(ctx)}::int)::text AS net
      ${linesFrom(ctx)} ${extra}
      ORDER BY o.order_date, o.order_number, i.line_no`,
  );
}

export const salesByProduct: ReportDefinition = {
  key: 'sales-by-product',
  title: 'Sales by product',
  description: 'What was sold, by product: quantity and net sales (after discounts, before tax).',
  requires: ['order:view', 'product:view'],
  financial: true,
  filters: [RANGE, { key: 'categoryId', label: 'Category' }, PERSON],
  columns: [
    { key: 'product', label: 'Product', type: 'text' },
    { key: 'quantity', label: 'Quantity', type: 'number', total: true },
    money('discounts', 'Discounts'),
    money('net', 'Net sales'),
  ],
  reconciles: [
    { column: 'net', drillColumn: 'net' },
    { column: 'quantity', drillColumn: 'quantity' },
  ],
  async query(ctx) {
    return asRows(
      await query<Record<string, unknown>>(
        ctx,
        Prisma.sql`
          SELECT COALESCE(i.product_id, 'custom') AS key, COALESCE(MAX(p.name), 'Custom items') AS product,
            SUM(i.quantity)::float8 AS quantity,
            ROUND(SUM(i.discount_amount), ${dp(ctx)}::int)::text AS discounts,
            ROUND(SUM(i.line_total - i.tax_amount), ${dp(ctx)}::int)::text AS net
          ${linesFrom(ctx)}
          GROUP BY COALESCE(i.product_id, 'custom') ORDER BY SUM(i.line_total - i.tax_amount) DESC, 2`,
      ),
    );
  },
  async drilldown(ctx) {
    const row = ctx.query.row
      ? ctx.query.row === 'custom'
        ? Prisma.sql`AND i.product_id IS NULL`
        : Prisma.sql`AND i.product_id = ${ctx.query.row}`
      : Prisma.empty;
    return { columns: LINE_COLUMNS, rows: asRows(await lineRows(ctx, row)) };
  },
};

export const salesByCategory: ReportDefinition = {
  key: 'sales-by-category',
  title: 'Sales by category',
  description: 'What was sold, by product category: quantity and net sales.',
  requires: ['order:view', 'product:view'],
  financial: true,
  filters: [RANGE, PERSON],
  columns: [
    { key: 'category', label: 'Category', type: 'text' },
    { key: 'quantity', label: 'Quantity', type: 'number', total: true },
    money('discounts', 'Discounts'),
    money('net', 'Net sales'),
  ],
  reconciles: [
    { column: 'net', drillColumn: 'net' },
    { column: 'quantity', drillColumn: 'quantity' },
  ],
  async query(ctx) {
    return asRows(
      await query<Record<string, unknown>>(
        ctx,
        Prisma.sql`
          SELECT COALESCE(p.category_id, 'none') AS key, COALESCE(MAX(cat.name), 'Uncategorised') AS category,
            SUM(i.quantity)::float8 AS quantity,
            ROUND(SUM(i.discount_amount), ${dp(ctx)}::int)::text AS discounts,
            ROUND(SUM(i.line_total - i.tax_amount), ${dp(ctx)}::int)::text AS net
          ${linesFrom(ctx)}
          GROUP BY COALESCE(p.category_id, 'none') ORDER BY SUM(i.line_total - i.tax_amount) DESC, 2`,
      ),
    );
  },
  async drilldown(ctx) {
    const row = ctx.query.row
      ? ctx.query.row === 'none'
        ? Prisma.sql`AND p.category_id IS NULL`
        : Prisma.sql`AND p.category_id = ${ctx.query.row}`
      : Prisma.empty;
    return { columns: LINE_COLUMNS, rows: asRows(await lineRows(ctx, row)) };
  },
};

/** Each salesperson's share of an order's net sales, rounded to the currency like every other amount. */
const shareAmount = (ctx: ReportContext) =>
  Prisma.sql`ROUND((o.total_amount - o.tax_amount) * os.share_percent / 100, ${dp(ctx)}::int)`;

const shareFrom = (ctx: ReportContext) => Prisma.sql`
  FROM order_salespeople os
  JOIN orders o ON o.id = os.order_id
  JOIN users u ON u.id = os.user_id
  WHERE o.workspace_id = ${ctx.workspaceId} AND ${orderNotDraftOrCancelled}
    AND o.order_date >= ${ctx.start} AND o.order_date < ${ctx.end} ${orderScope(ctx)}
    ${ctx.query.salespersonId ? Prisma.sql`AND os.user_id = ${ctx.query.salespersonId}` : Prisma.empty}`;

export const salesBySalesperson: ReportDefinition = {
  key: 'sales-by-salesperson',
  title: 'Sales by salesperson',
  description: 'Net sales credited to each salesperson, by their share of each order.',
  requires: ['order:view'],
  financial: true,
  filters: [RANGE, PERSON],
  columns: [
    { key: 'salesperson', label: 'Salesperson', type: 'text' },
    { key: 'orders', label: 'Orders', type: 'number', total: true },
    money('net', 'Net sales'),
  ],
  reconciles: [{ column: 'net', drillColumn: 'net' }],
  async query(ctx) {
    return asRows(
      await query<Record<string, unknown>>(
        ctx,
        Prisma.sql`
          SELECT os.user_id AS key, MAX(u.first_name || ' ' || u.last_name) AS salesperson,
            COUNT(*)::int AS orders, SUM(${shareAmount(ctx)})::text AS net
          ${shareFrom(ctx)} GROUP BY os.user_id ORDER BY SUM(${shareAmount(ctx)}) DESC, 2`,
      ),
    );
  },
  async drilldown(ctx) {
    const row = ctx.query.row ? Prisma.sql`AND os.user_id = ${ctx.query.row}` : Prisma.empty;
    return {
      columns: [
        { key: 'orderNumber', label: 'Order', type: 'text', link: 'order:orderId' },
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'salesperson', label: 'Salesperson', type: 'text' },
        { key: 'share', label: 'Share (%)', type: 'percent' },
        money('net', 'Net sales'),
      ],
      rows: asRows(
        await query<Record<string, unknown>>(
          ctx,
          Prisma.sql`
            SELECT os.id AS key, o.id AS "orderId", o.order_number AS "orderNumber", ${day(ctx)} AS date,
              u.first_name || ' ' || u.last_name AS salesperson, os.share_percent::float8 AS share,
              ${shareAmount(ctx)}::text AS net
            ${shareFrom(ctx)} ${row} ORDER BY o.order_date, o.order_number`,
        ),
      ),
    };
  },
};

export const salesHistory: ReportDefinition = {
  key: 'sales-history',
  title: 'Sales history',
  description: 'Every sale in the period with what was paid and what is still owed.',
  requires: ['order:view'],
  financial: true,
  filters: [RANGE, PERSON, { key: 'status', label: 'Status' }],
  columns: [
    { key: 'orderNumber', label: 'Order', type: 'text', link: 'order:orderId' },
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'customer', label: 'Customer', type: 'text' },
    { key: 'salesperson', label: 'Salesperson', type: 'text' },
    { key: 'status', label: 'Status', type: 'text' },
    money('total', 'Total'),
    money('paid', 'Paid'),
    money('balance', 'Balance due'),
  ],
  reconciles: [{ column: 'total', drillColumn: 'lineTotal' }],
  async query(ctx) {
    return asRows(
      await query<Record<string, unknown>>(
        ctx,
        Prisma.sql`
          SELECT o.id AS key, o.id AS "orderId", o.order_number AS "orderNumber", ${day(ctx)} AS date,
            c.full_name AS customer, COALESCE(u.first_name || ' ' || u.last_name, '') AS salesperson,
            o.status, ROUND(o.total_amount, ${dp(ctx)}::int)::text AS total,
            ROUND(o.paid_amount - o.refunded_amount, ${dp(ctx)}::int)::text AS paid,
            ROUND(o.balance_due, ${dp(ctx)}::int)::text AS balance
          FROM orders o JOIN customers c ON c.id = o.customer_id LEFT JOIN users u ON u.id = o.assigned_to_id
          WHERE ${salesOrders(ctx)} ${ctx.query.status ? Prisma.sql`AND o.status = ${ctx.query.status}` : Prisma.empty}
          ORDER BY o.order_date DESC, o.order_number DESC LIMIT ${ctx.limit + 1}`,
      ),
    );
  },
  /** An order's lines, and the cash rounding that brings them to the total. */
  async drilldown(ctx) {
    const row = ctx.query.row ? Prisma.sql`AND o.id = ${ctx.query.row}` : Prisma.empty;
    const columns: ReportColumn[] = [
      { key: 'orderNumber', label: 'Order', type: 'text', link: 'order:orderId' },
      { key: 'item', label: 'Item', type: 'text' },
      { key: 'quantity', label: 'Quantity', type: 'number' },
      money('lineTotal', 'Line total'),
    ];
    const lines = await query<Record<string, unknown>>(
      ctx,
      Prisma.sql`
        SELECT i.id AS key, o.id AS "orderId", o.order_number AS "orderNumber", i.name AS item,
          i.quantity::float8 AS quantity, ROUND(i.line_total, ${dp(ctx)}::int)::text AS "lineTotal"
        FROM order_items i JOIN orders o ON o.id = i.order_id
        WHERE ${salesOrders(ctx)} ${row} ORDER BY o.order_date DESC, o.order_number DESC, i.line_no`,
    );
    const rounding = await query<Record<string, unknown>>(
      ctx,
      Prisma.sql`
        SELECT 'rounding-' || o.id AS key, o.id AS "orderId", o.order_number AS "orderNumber",
          'Rounding' AS item, NULL::float8 AS quantity,
          ROUND(o.rounding_amount, ${dp(ctx)}::int)::text AS "lineTotal"
        FROM orders o WHERE ${salesOrders(ctx)} ${row} AND o.rounding_amount <> 0
        ORDER BY o.order_date DESC, o.order_number DESC`,
    );
    return { columns, rows: asRows([...lines, ...rounding]) };
  },
};

export const ordersByStatus: ReportDefinition = {
  key: 'orders-by-status',
  title: 'Orders by status',
  description: 'How many orders are in each status, and what they are worth.',
  requires: ['order:view'],
  financial: false,
  filters: [RANGE, PERSON],
  columns: [
    { key: 'status', label: 'Status', type: 'text' },
    { key: 'orders', label: 'Orders', type: 'number', total: true },
    money('total', 'Value'),
  ],
  reconciles: [
    { column: 'orders', drillColumn: 'count' },
    { column: 'total', drillColumn: 'total' },
  ],
  async query(ctx) {
    return asRows(
      await query<Record<string, unknown>>(
        ctx,
        Prisma.sql`
          SELECT o.status AS key, COALESCE(MAX(s.label), o.status) AS status, COUNT(*)::int AS orders,
            ROUND(SUM(o.total_amount), ${dp(ctx)}::int)::text AS total
          FROM orders o
          LEFT JOIN workflows w ON w.workspace_id = o.workspace_id AND w.entity_type = 'ORDER'::workflow_entity
          LEFT JOIN workflow_states s ON s.workflow_id = w.id AND s.key = o.status
          WHERE ${allOrders(ctx)}
          GROUP BY o.status ORDER BY COALESCE(MAX(s.sort_order), 999), 2`,
      ),
    );
  },
  async drilldown(ctx) {
    const row = ctx.query.row ? Prisma.sql`AND o.status = ${ctx.query.row}` : Prisma.empty;
    const rows = await orderRows(ctx, Prisma.sql`${allOrders(ctx)} ${row}`);
    return {
      columns: [...ORDER_COLUMNS, { key: 'count', label: 'Count', type: 'number', total: true }],
      rows: asRows(rows.map((r) => ({ ...r, count: 1 }))),
    };
  },
};

/** Every order in the period whatever its status, for the report that counts them by status. */
function allOrders(ctx: ReportContext): Prisma.Sql {
  const person = ctx.query.salespersonId
    ? Prisma.sql`AND o.assigned_to_id = ${ctx.query.salespersonId}`
    : Prisma.empty;
  return Prisma.sql`o.workspace_id = ${ctx.workspaceId}
    AND o.order_date >= ${ctx.start} AND o.order_date < ${ctx.end} ${person} ${orderScope(ctx)}`;
}

export const customerBalances: ReportDefinition = {
  key: 'customer-balances',
  title: 'Customer balances',
  description: 'What customers still owe, by how long it has been outstanding.',
  requires: ['order:view', 'payment:view'],
  financial: true,
  filters: [],
  columns: [
    { key: 'customer', label: 'Customer', type: 'text' },
    { key: 'orders', label: 'Orders', type: 'number', total: true },
    money('balance', 'Balance due'),
    money('age0to30', '0–30 days'),
    money('age31to60', '31–60 days'),
    money('age61to90', '61–90 days'),
    money('ageOver90', 'Over 90 days'),
  ],
  reconciles: [
    { column: 'balance', drillColumn: 'balance' },
    { column: 'age0to30', drillColumn: 'age0to30' },
    { column: 'ageOver90', drillColumn: 'ageOver90' },
  ],
  async query(ctx) {
    const bucket = (low: number, high: number | null) =>
      Prisma.sql`ROUND(COALESCE(SUM(CASE WHEN age >= ${low} ${high === null ? Prisma.empty : Prisma.sql`AND age <= ${high}`} THEN balance_due END), 0), ${dp(ctx)}::int)::text`;
    return asRows(
      await query<Record<string, unknown>>(
        ctx,
        Prisma.sql`
          SELECT customer_id AS key, MAX(full_name) AS customer, COUNT(*)::int AS orders,
            ROUND(SUM(balance_due), ${dp(ctx)}::int)::text AS balance,
            ${bucket(0, 30)} AS "age0to30", ${bucket(31, 60)} AS "age31to60",
            ${bucket(61, 90)} AS "age61to90", ${bucket(91, null)} AS "ageOver90"
          FROM (${owing(ctx)}) x GROUP BY customer_id ORDER BY SUM(balance_due) DESC, 2`,
      ),
    );
  },
  async drilldown(ctx) {
    const row = ctx.query.row ? Prisma.sql`WHERE customer_id = ${ctx.query.row}` : Prisma.empty;
    const bucket = (low: number, high: number | null) =>
      Prisma.sql`ROUND(CASE WHEN age >= ${low} ${high === null ? Prisma.empty : Prisma.sql`AND age <= ${high}`} THEN balance_due ELSE 0 END, ${dp(ctx)}::int)::text`;
    return {
      columns: [
        { key: 'orderNumber', label: 'Order', type: 'text', link: 'order:orderId' },
        { key: 'customer', label: 'Customer', type: 'text' },
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'age', label: 'Days outstanding', type: 'number' },
        money('balance', 'Balance due'),
        money('age0to30', '0–30 days'),
        money('age31to60', '31–60 days'),
        money('age61to90', '61–90 days'),
        money('ageOver90', 'Over 90 days'),
      ],
      rows: asRows(
        await query<Record<string, unknown>>(
          ctx,
          Prisma.sql`
            SELECT id AS key, id AS "orderId", order_number AS "orderNumber", full_name AS customer, day AS date, age::int AS age,
              ROUND(balance_due, ${dp(ctx)}::int)::text AS balance,
              ${bucket(0, 30)} AS "age0to30", ${bucket(31, 60)} AS "age31to60",
              ${bucket(61, 90)} AS "age61to90", ${bucket(91, null)} AS "ageOver90"
            FROM (${owing(ctx)}) x ${row} ORDER BY day, order_number`,
        ),
      ),
    };
  },
};

/** Orders with money still to pay, with their age in days at the end of today. */
function owing(ctx: ReportContext): Prisma.Sql {
  const range = ctx.explicitRange
    ? Prisma.sql`AND o.order_date >= ${ctx.start} AND o.order_date < ${ctx.end}`
    : Prisma.empty;
  return Prisma.sql`
    SELECT o.id, o.order_number, o.customer_id, c.full_name, o.balance_due,
      ${day(ctx)} AS day,
      (${ctx.today}::date - ((o.order_date AT TIME ZONE 'UTC') AT TIME ZONE ${ctx.timezone})::date) AS age
    FROM orders o JOIN customers c ON c.id = o.customer_id
    WHERE o.workspace_id = ${ctx.workspaceId} AND ${orderNotDraftOrCancelled}
      AND o.balance_due > 0 ${range} ${orderScope(ctx)}`;
}

export const paymentMethods: ReportDefinition = {
  key: 'payment-methods',
  title: 'Payment methods',
  description: 'Money received and refunded by payment method (confirmed payments only).',
  requires: ['payment:view'],
  financial: true,
  filters: [RANGE],
  columns: [
    { key: 'method', label: 'Payment method', type: 'text' },
    { key: 'payments', label: 'Payments', type: 'number', total: true },
    money('received', 'Received'),
    money('refunded', 'Refunded'),
    money('net', 'Net'),
  ],
  reconciles: [{ column: 'net', drillColumn: 'signed' }],
  async query(ctx) {
    return asRows(
      await query<Record<string, unknown>>(
        ctx,
        Prisma.sql`
          SELECT COALESCE(p.payment_method_id, 'none') AS key, COALESCE(MAX(m.name), 'Other') AS method,
            COUNT(*)::int AS payments,
            ROUND(COALESCE(SUM(CASE WHEN p.type <> 'REFUND' THEN p.amount END), 0), ${dp(ctx)}::int)::text AS received,
            ROUND(COALESCE(SUM(CASE WHEN p.type = 'REFUND' THEN p.amount END), 0), ${dp(ctx)}::int)::text AS refunded,
            ROUND(SUM(CASE WHEN p.type = 'REFUND' THEN -p.amount ELSE p.amount END), ${dp(ctx)}::int)::text AS net
          ${paymentsFrom(ctx)} GROUP BY COALESCE(p.payment_method_id, 'none') ORDER BY 6 DESC, 2`,
      ),
    );
  },
  async drilldown(ctx) {
    const row = ctx.query.row
      ? ctx.query.row === 'none'
        ? Prisma.sql`AND p.payment_method_id IS NULL`
        : Prisma.sql`AND p.payment_method_id = ${ctx.query.row}`
      : Prisma.empty;
    return {
      columns: [
        { key: 'paymentNumber', label: 'Payment', type: 'text' },
        { key: 'date', label: 'Date', type: 'date' },
        { key: 'type', label: 'Type', type: 'text' },
        { key: 'method', label: 'Payment method', type: 'text' },
        { key: 'reference', label: 'Reference', type: 'text' },
        money('signed', 'Amount'),
      ],
      rows: asRows(
        await query<Record<string, unknown>>(
          ctx,
          Prisma.sql`
            SELECT p.id AS key, p.payment_number AS "paymentNumber",
              to_char((p.paid_at AT TIME ZONE 'UTC') AT TIME ZONE ${ctx.timezone}, 'YYYY-MM-DD') AS date,
              p.type::text AS type, COALESCE(m.name, 'Other') AS method, p.reference_number AS reference,
              ROUND(CASE WHEN p.type = 'REFUND' THEN -p.amount ELSE p.amount END, ${dp(ctx)}::int)::text AS signed
            ${paymentsFrom(ctx)} ${row} ORDER BY p.paid_at, p.payment_number`,
        ),
      ),
    };
  },
};

/** Confirmed payments that moved money (credit applied to an order moves none), in the period. */
const paymentsFrom = (ctx: ReportContext) => Prisma.sql`
  FROM payments p LEFT JOIN payment_methods m ON m.id = p.payment_method_id
  WHERE p.workspace_id = ${ctx.workspaceId} AND p.status = 'CONFIRMED'
    AND p.type IN ('ORDER_PAYMENT', 'DEPOSIT', 'ADVANCE', 'REFUND')
    AND p.paid_at >= ${ctx.start} AND p.paid_at < ${ctx.end}`;

export const SALES_REPORTS: ReportDefinition[] = [
  salesByDate,
  salesByProduct,
  salesByCategory,
  salesBySalesperson,
  salesHistory,
  ordersByStatus,
  customerBalances,
  paymentMethods,
];
