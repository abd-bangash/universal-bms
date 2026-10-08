import type { AuthUser } from '../../common/decorators/current-user.decorator';
import type { PrismaService } from '../../common/prisma/prisma.service';
import type { RangePreset } from './report-dates';

export type ColumnType = 'text' | 'money' | 'number' | 'percent' | 'date' | 'datetime';

export interface ReportColumn {
  key: string;
  label: string;
  type: ColumnType;
  /** A revenue, cost, profit or payment figure: removed for people without `report:financial` (Requirement 19.8). */
  financial?: boolean;
  /** Shown in the totals line, added up from the rows. */
  total?: boolean;
  /** A link to the record this cell names, resolved by the web app: `order:<id>` and the like. */
  link?: string;
}

export interface ReportFilterSpec {
  key: 'range' | 'salespersonId' | 'categoryId' | 'locationId' | 'status' | 'stage' | 'source';
  label: string;
}

/** What the person asked for; every report reads the parts it declares. */
export interface ReportQuery {
  from?: string;
  to?: string;
  range?: RangePreset;
  salespersonId?: string;
  categoryId?: string;
  locationId?: string;
  status?: string;
  stage?: string;
  source?: string;
  /** The row to drill into; none means the records behind the whole total. */
  row?: string;
  limit?: number;
}

export interface ReportContext {
  prisma: PrismaService;
  user: AuthUser;
  workspaceId: string;
  timezone: string;
  currencyDecimals: number;
  /** The days the report covers, as local calendar days. */
  range: { from: string; to: string };
  /** The instants those days start and end (end is the start of the next day). */
  start: Date;
  end: Date;
  /** Today as a local calendar day. */
  today: string;
  /** The person asked for a date range, rather than leaving it to the default. */
  explicitRange: boolean;
  /** Most rows a row-per-record report returns. */
  limit: number;
  query: ReportQuery;
}

export type ReportRow = Record<string, string | number | null> & { key: string };

export interface DrilldownResult {
  columns: ReportColumn[];
  rows: ReportRow[];
}

export interface ReportDefinition {
  key: string;
  title: string;
  description: string;
  /** All of these, as well as `report:view`, are needed to run it. */
  requires: readonly string[];
  /** Revenue, cost or payment figures throughout: needs `report:financial` as a whole. */
  financial: boolean;
  filters: readonly ReportFilterSpec[];
  columns: readonly ReportColumn[];
  /** Pairs checked by the reconciliation tests: the column of the report and the drill-down column that adds up to it. */
  reconciles: ReadonlyArray<{ column: string; drillColumn: string }>;
  query(ctx: ReportContext): Promise<ReportRow[]>;
  drilldown(ctx: ReportContext): Promise<DrilldownResult>;
  /** Totals that are not simple sums (a rate over the whole period); merged over the summed ones. */
  totals?(rows: ReportRow[], ctx: ReportContext): Record<string, string>;
}

export interface ReportResult {
  key: string;
  title: string;
  range: { from: string; to: string };
  columns: ReportColumn[];
  rows: ReportRow[];
  totals: Record<string, string>;
  truncated: boolean;
}
