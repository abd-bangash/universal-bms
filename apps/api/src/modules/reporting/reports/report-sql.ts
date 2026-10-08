import { Prisma } from '@prisma/client';
import type { ReportContext, ReportRow } from '../reporting.types';

/** The keys of the workflow states that are drafts or cancelled for one kind of record. */
const excludedStates = (entity: 'ORDER' | 'PURCHASE_ORDER', roles: string) =>
  Prisma.sql`(SELECT s.key FROM workflow_states s JOIN workflows w ON w.id = s.workflow_id
     WHERE w.workspace_id = s.workspace_id AND w.entity_type = ${entity}::workflow_entity
       AND (s.system_role IN (${Prisma.raw(roles)}) OR s.category = 'CANCELLED'))`;

/** Orders that are neither drafts nor cancelled: the ones that count as sales. */
export const orderNotDraftOrCancelled = Prisma.sql`o.status NOT IN ${excludedStates('ORDER', "'DRAFT', 'CANCELLED'")}`;
export const purchaseNotDraftOrCancelled = Prisma.sql`po.status NOT IN ${excludedStates('PURCHASE_ORDER', "'DRAFT', 'CANCELLED'")}`;
export const purchaseNotCancelled = Prisma.sql`po.status NOT IN ${excludedStates('PURCHASE_ORDER', "'CANCELLED'")}`;

/** People without `order:view_all` see only their own orders (Requirement 54.2). */
export function orderScope(ctx: ReportContext): Prisma.Sql {
  return ctx.user.permissions.includes('order:view_all')
    ? Prisma.empty
    : Prisma.sql`AND (o.assigned_to_id = ${ctx.user.userId} OR o.created_by_id = ${ctx.user.userId})`;
}

/**
 * Orders that count as sales, dated by `order_date` in the workspace timezone (design.md,
 * Reporting): not drafts, not cancelled. People without `order:view_all` see only their own.
 */
export function salesOrders(ctx: ReportContext, withRange = true): Prisma.Sql {
  const range = withRange
    ? Prisma.sql`AND o.order_date >= ${ctx.start} AND o.order_date < ${ctx.end}`
    : Prisma.empty;
  const person = ctx.query.salespersonId
    ? Prisma.sql`AND o.assigned_to_id = ${ctx.query.salespersonId}`
    : Prisma.empty;
  return Prisma.sql`o.workspace_id = ${ctx.workspaceId}
    AND ${orderNotDraftOrCancelled} ${range} ${person} ${orderScope(ctx)}`;
}

/** A money value from SQL as text with the currency's decimals. */
export const moneyText = (column: string, decimals: number): Prisma.Sql =>
  Prisma.sql`ROUND(${Prisma.raw(column)}, ${decimals}::int)::text`;

export const query = <T>(ctx: ReportContext, sql: Prisma.Sql): Promise<T[]> =>
  ctx.prisma.scoped.$queryRaw<T[]>(sql);

export const asRows = (rows: Array<Record<string, unknown>>): ReportRow[] =>
  rows.map((r) => ({
    ...Object.fromEntries(
      Object.entries(r).map(([k, v]) => [
        k,
        typeof v === 'bigint' ? Number(v) : v instanceof Prisma.Decimal ? v.toString() : v,
      ]),
    ),
    key: String(r['key']),
  })) as ReportRow[];

/** The local calendar day of a timestamp column. */
export const localDate = (column: string, ctx: ReportContext): Prisma.Sql =>
  Prisma.sql`((${Prisma.raw(column)} AT TIME ZONE 'UTC') AT TIME ZONE ${ctx.timezone})::date`;
