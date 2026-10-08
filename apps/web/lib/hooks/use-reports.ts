'use client';

import { useQuery } from '@tanstack/react-query';
import { api, type QueryParams } from '../api-client';

export type ColumnType = 'text' | 'money' | 'number' | 'percent' | 'date' | 'datetime';

export interface ReportColumn {
  key: string;
  label: string;
  type: ColumnType;
  financial?: boolean;
  total?: boolean;
  /** `order:orderId`: a link to the order whose id is in that field of the row. */
  link?: string;
}

export interface ReportSummary {
  key: string;
  title: string;
  description: string;
  financial: boolean;
  filters: Array<{ key: string; label: string }>;
  columns: ReportColumn[];
}

export type ReportRow = { key: string } & Record<string, string | number | null>;

export interface ReportResult {
  key: string;
  title: string;
  range: { from: string; to: string };
  columns: ReportColumn[];
  rows: ReportRow[];
  totals: Record<string, string>;
  truncated: boolean;
}

export interface DrilldownResult {
  columns: ReportColumn[];
  rows: ReportRow[];
  truncated: boolean;
}

export interface ReportFilters {
  range?: 'today' | 'week' | 'month';
  from?: string;
  to?: string;
  salespersonId?: string;
  categoryId?: string;
  locationId?: string;
  status?: string;
  stage?: string;
  source?: string;
}

export interface Dashboard {
  generatedAt: string;
  timezone: string;
  salesToday?: { orders: number; total: string };
  salesWeek?: { orders: number; total: string };
  salesMonth?: { orders: number; total: string };
  openOrders?: Array<{ status: string; label: string; count: number }>;
  leadFunnel?: Array<{ stage: string; label: string; count: number }>;
  lowStock?: { count: number };
  outstandingBalances?: { customers: number; total: string };
  pendingCommissions?: { count: number; amount?: string };
  myTasks?: {
    overdue: number;
    today: number;
    items: Array<{ id: string; title: string; dueAt: string | null }>;
  };
}

const clean = (filters: ReportFilters & { row?: string }): QueryParams =>
  Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined && v !== ''));

export function useReportCatalogue() {
  return useQuery({
    queryKey: ['reports', 'catalogue'],
    queryFn: ({ signal }) => api.get<ReportSummary[]>('/reports', undefined, signal),
    staleTime: 5 * 60_000,
  });
}

export function useReport(key: string, filters: ReportFilters, enabled = true) {
  return useQuery<ReportResult>({
    queryKey: ['reports', 'run', key, filters],
    enabled,
    placeholderData: (previous) => previous,
    queryFn: ({ signal }) => api.get<ReportResult>(`/reports/${key}`, clean(filters), signal),
  });
}

export function useDrilldown(key: string, filters: ReportFilters, row: string | null) {
  return useQuery({
    queryKey: ['reports', 'drilldown', key, filters, row],
    enabled: row !== null,
    queryFn: ({ signal }) =>
      api.get<DrilldownResult>(
        `/reports/${key}/drilldown`,
        clean({ ...filters, row: row || undefined }),
        signal,
      ),
  });
}

export function useDashboard() {
  return useQuery({
    queryKey: ['reports', 'dashboard'],
    queryFn: ({ signal }) => api.get<Dashboard>('/reports/dashboard', undefined, signal),
    staleTime: 60_000,
  });
}

/** Downloads a report as CSV through the browser's own save mechanism. */
export async function downloadReport(key: string, filters: ReportFilters): Promise<void> {
  const { blob, filename } = await api.download(`/reports/${key}/export`, clean(filters));
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename ?? `${key}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
