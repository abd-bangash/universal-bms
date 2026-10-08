import { Prisma } from '@prisma/client';
import type { ReportColumn, ReportContext, ReportDefinition } from '../reporting.types';
import { asRows, query } from './report-sql';

const dp = (ctx: ReportContext) => ctx.currencyDecimals;

const leadStates = (roles: string) => Prisma.sql`(SELECT s.key FROM workflow_states s
  JOIN workflows w ON w.id = s.workflow_id
  WHERE w.workspace_id = s.workspace_id AND w.entity_type = 'LEAD'::workflow_entity
    AND s.system_role IN (${Prisma.raw(roles)}))`;

/** People without `lead:view_all` see only their own leads; a date range applies only when asked for. */
function leadsWhere(ctx: ReportContext): Prisma.Sql {
  const scope = ctx.user.permissions.includes('lead:view_all')
    ? Prisma.empty
    : Prisma.sql`AND (l.assigned_to_id = ${ctx.user.userId} OR l.created_by_id = ${ctx.user.userId})`;
  const range = ctx.explicitRange
    ? Prisma.sql`AND l.created_at >= ${ctx.start} AND l.created_at < ${ctx.end}`
    : Prisma.empty;
  const person = ctx.query.salespersonId
    ? Prisma.sql`AND l.assigned_to_id = ${ctx.query.salespersonId}`
    : Prisma.empty;
  return Prisma.sql`l.workspace_id = ${ctx.workspaceId} ${range} ${scope} ${person}`;
}

const LEAD_COLUMNS: ReportColumn[] = [
  { key: 'name', label: 'Lead', type: 'text', link: 'lead:leadId' },
  { key: 'stage', label: 'Stage', type: 'text' },
  { key: 'source', label: 'Source', type: 'text' },
  { key: 'assignedTo', label: 'Assigned to', type: 'text' },
  { key: 'createdOn', label: 'Created', type: 'date' },
  { key: 'estimatedValue', label: 'Estimated value', type: 'money', financial: true, total: true },
  { key: 'count', label: 'Count', type: 'number', total: true },
];

function leadRows(ctx: ReportContext, extra: Prisma.Sql) {
  return query<Record<string, unknown>>(
    ctx,
    Prisma.sql`
      SELECT l.id AS key, l.id AS "leadId", l.full_name AS name, COALESCE(s.label, l.stage) AS stage,
        COALESCE(l.source, 'Unknown') AS source, COALESCE(u.first_name || ' ' || u.last_name, '') AS "assignedTo",
        to_char((l.created_at AT TIME ZONE 'UTC') AT TIME ZONE ${ctx.timezone}, 'YYYY-MM-DD') AS "createdOn",
        ROUND(COALESCE(l.estimated_value, 0), ${dp(ctx)}::int)::text AS "estimatedValue", 1 AS count
      FROM leads l
      LEFT JOIN users u ON u.id = l.assigned_to_id
      LEFT JOIN workflows w ON w.workspace_id = l.workspace_id AND w.entity_type = 'LEAD'::workflow_entity
      LEFT JOIN workflow_states s ON s.workflow_id = w.id AND s.key = l.stage
      WHERE ${leadsWhere(ctx)} ${extra} ORDER BY l.created_at, l.full_name`,
  );
}

export const leadPipeline: ReportDefinition = {
  key: 'lead-pipeline',
  title: 'Lead pipeline',
  description: 'How many leads are in each stage and what they might be worth.',
  requires: ['lead:view'],
  financial: false,
  filters: [
    { key: 'range', label: 'Created' },
    { key: 'salespersonId', label: 'Assigned to' },
  ],
  columns: [
    { key: 'stage', label: 'Stage', type: 'text' },
    { key: 'leads', label: 'Leads', type: 'number', total: true },
    {
      key: 'estimatedValue',
      label: 'Estimated value',
      type: 'money',
      financial: true,
      total: true,
    },
  ],
  reconciles: [
    { column: 'leads', drillColumn: 'count' },
    { column: 'estimatedValue', drillColumn: 'estimatedValue' },
  ],
  async query(ctx) {
    return asRows(
      await query<Record<string, unknown>>(
        ctx,
        Prisma.sql`
          SELECT l.stage AS key, COALESCE(MAX(s.label), l.stage) AS stage, COUNT(*)::int AS leads,
            ROUND(COALESCE(SUM(l.estimated_value), 0), ${dp(ctx)}::int)::text AS "estimatedValue"
          FROM leads l
          LEFT JOIN workflows w ON w.workspace_id = l.workspace_id AND w.entity_type = 'LEAD'::workflow_entity
          LEFT JOIN workflow_states s ON s.workflow_id = w.id AND s.key = l.stage
          WHERE ${leadsWhere(ctx)} GROUP BY l.stage ORDER BY COALESCE(MAX(s.sort_order), 999), 2`,
      ),
    );
  },
  async drilldown(ctx) {
    const row = ctx.query.row ? Prisma.sql`AND l.stage = ${ctx.query.row}` : Prisma.empty;
    return { columns: LEAD_COLUMNS, rows: asRows(await leadRows(ctx, row)) };
  },
};

export const leadConversion: ReportDefinition = {
  key: 'lead-conversion',
  title: 'Lead conversion',
  description: 'Leads won and lost by where they came from, and the share that were won.',
  requires: ['lead:view'],
  financial: false,
  filters: [
    { key: 'range', label: 'Created' },
    { key: 'salespersonId', label: 'Assigned to' },
  ],
  columns: [
    { key: 'source', label: 'Source', type: 'text' },
    { key: 'leads', label: 'Leads', type: 'number', total: true },
    { key: 'won', label: 'Won', type: 'number', total: true },
    { key: 'lost', label: 'Lost', type: 'number', total: true },
    { key: 'rate', label: 'Conversion rate', type: 'percent' },
  ],
  reconciles: [{ column: 'leads', drillColumn: 'count' }],
  async query(ctx) {
    return asRows(
      await query<Record<string, unknown>>(
        ctx,
        Prisma.sql`
          SELECT COALESCE(l.source, 'Unknown') AS key, COALESCE(l.source, 'Unknown') AS source,
            COUNT(*)::int AS leads,
            COUNT(*) FILTER (WHERE l.stage IN ${leadStates("'WON'")})::int AS won,
            COUNT(*) FILTER (WHERE l.stage IN ${leadStates("'LOST'")})::int AS lost,
            ROUND(100.0 * COUNT(*) FILTER (WHERE l.stage IN ${leadStates("'WON'")}) / COUNT(*), 2)::text AS rate
          FROM leads l WHERE ${leadsWhere(ctx)}
          GROUP BY COALESCE(l.source, 'Unknown') ORDER BY COUNT(*) DESC, 2`,
      ),
    );
  },
  totals(rows) {
    const leads = rows.reduce((n, r) => n + Number(r['leads'] ?? 0), 0);
    const won = rows.reduce((n, r) => n + Number(r['won'] ?? 0), 0);
    return { rate: leads === 0 ? '0.00' : ((won * 100) / leads).toFixed(2) };
  },
  async drilldown(ctx) {
    const row = ctx.query.row
      ? ctx.query.row === 'Unknown'
        ? Prisma.sql`AND l.source IS NULL`
        : Prisma.sql`AND l.source = ${ctx.query.row}`
      : Prisma.empty;
    return { columns: LEAD_COLUMNS, rows: asRows(await leadRows(ctx, row)) };
  },
};

export const LEAD_REPORTS: ReportDefinition[] = [leadPipeline, leadConversion];
