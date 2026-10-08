import { Injectable } from '@nestjs/common';
import Decimal from 'decimal.js';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import { AppException, NotFoundAppException } from '../../common/errors/app.exception';
import { PrismaService } from '../../common/prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import { addDays, localDay, localDayStart, resolveRange } from './report-dates';
import { ReportRegistry } from './report.registry';
import type {
  DrilldownResult,
  ReportColumn,
  ReportContext,
  ReportDefinition,
  ReportQuery,
  ReportResult,
  ReportRow,
} from './reporting.types';

export const DEFAULT_ROW_LIMIT = 1000;

export interface ReportSummary {
  key: string;
  title: string;
  description: string;
  financial: boolean;
  filters: ReportDefinition['filters'];
  columns: ReportColumn[];
}

@Injectable()
export class ReportingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
    private readonly registry: ReportRegistry,
  ) {}

  /** The reports this person may run (Requirement 19.8): without `report:financial` the money reports are not listed. */
  catalogue(user: AuthUser): ReportSummary[] {
    return this.registry
      .all()
      .filter((def) => this.allowed(user, def))
      .map((def) => ({
        key: def.key,
        title: def.title,
        description: def.description,
        financial: def.financial,
        filters: def.filters,
        columns: this.visibleColumns(user, def.columns),
      }));
  }

  async run(user: AuthUser, key: string, query: ReportQuery): Promise<ReportResult> {
    const def = this.definition(user, key);
    const ctx = await this.context(user, query);
    const found = await def.query(ctx);
    const truncated = found.length > ctx.limit;
    const rows = truncated ? found.slice(0, ctx.limit) : found;
    const totals = this.totals(def, rows, ctx);
    const columns = this.visibleColumns(user, def.columns);
    return {
      key: def.key,
      title: def.title,
      range: ctx.range,
      columns,
      rows: this.strip(rows, columns),
      totals: this.stripTotals(totals, columns),
      truncated,
    };
  }

  /** The records behind a row, or behind the whole total when no row is named (Requirement 19.4). */
  async drilldown(
    user: AuthUser,
    key: string,
    query: ReportQuery,
  ): Promise<DrilldownResult & { truncated: boolean }> {
    const def = this.definition(user, key);
    const ctx = await this.context(user, query);
    const result = await def.drilldown(ctx);
    const truncated = result.rows.length > ctx.limit;
    const columns = this.visibleColumns(user, result.columns);
    return {
      columns,
      rows: this.strip(truncated ? result.rows.slice(0, ctx.limit) : result.rows, columns),
      truncated,
    };
  }

  // ── shared with the export and the reconciliation tests ─────────────────────────────────

  definition(user: AuthUser, key: string): ReportDefinition {
    const def = this.registry.get(key);
    if (!def) throw new NotFoundAppException();
    if (!this.allowed(user, def)) {
      throw new AppException('PERMISSION_DENIED', 403, 'You do not have permission to do this');
    }
    return def;
  }

  async context(user: AuthUser, query: ReportQuery): Promise<ReportContext> {
    const [timezone, currencyDecimals] = await Promise.all([
      this.settings.get<string>('locale.timezone'),
      this.settings.get<number>('locale.currencyDecimals'),
    ]);
    const range = resolveRange(query, timezone);
    return {
      prisma: this.prisma,
      user,
      workspaceId: user.workspaceId,
      timezone,
      currencyDecimals,
      range,
      start: localDayStart(range.from, timezone),
      end: localDayStart(addDays(range.to, 1), timezone),
      today: localDay(new Date(), timezone),
      explicitRange: !!(query.from || query.to || query.range),
      limit: query.limit ?? DEFAULT_ROW_LIMIT,
      query,
    };
  }

  private allowed(user: AuthUser, def: ReportDefinition): boolean {
    return (
      user.permissions.includes('report:view') &&
      def.requires.every((p) => user.permissions.includes(p)) &&
      (!def.financial || user.permissions.includes('report:financial'))
    );
  }

  /** Money columns marked financial are dropped for people without `report:financial` (Requirement 19.8). */
  visibleColumns(user: AuthUser, columns: readonly ReportColumn[]): ReportColumn[] {
    const financial = user.permissions.includes('report:financial');
    return columns.filter((c) => financial || !c.financial);
  }

  private totals(
    def: ReportDefinition,
    rows: ReportRow[],
    ctx: ReportContext,
  ): Record<string, string> {
    const totals: Record<string, string> = {};
    for (const column of def.columns.filter((c) => c.total)) {
      const sum = rows.reduce(
        (acc, r) => acc.plus(new Decimal(String(r[column.key] ?? 0))),
        new Decimal(0),
      );
      totals[column.key] =
        column.type === 'money' ? sum.toFixed(ctx.currencyDecimals) : sum.toString();
    }
    return { ...totals, ...(def.totals?.(rows, ctx) ?? {}) };
  }

  /** Keeps what the visible columns show, the row key, and the ids that links need. */
  private strip(rows: ReportRow[], columns: ReportColumn[]): ReportRow[] {
    const keep = new Set<string>(['key']);
    for (const c of columns) {
      keep.add(c.key);
      if (c.link) keep.add(c.link.split(':')[1] as string);
    }
    return rows.map(
      (r) => Object.fromEntries(Object.entries(r).filter(([k]) => keep.has(k))) as ReportRow,
    );
  }

  private stripTotals(
    totals: Record<string, string>,
    columns: ReportColumn[],
  ): Record<string, string> {
    const visible = new Set(columns.map((c) => c.key));
    return Object.fromEntries(Object.entries(totals).filter(([k]) => visible.has(k)));
  }
}
