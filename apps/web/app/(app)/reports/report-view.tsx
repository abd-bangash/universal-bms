'use client';

import { useState } from 'react';
import Decimal from 'decimal.js';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { useErrorMessage } from '@/lib/error-message';
import { flattenCategories, useCategoriesQuery } from '@/lib/hooks/use-catalog';
import { useStaffQuery } from '@/lib/hooks/use-crm';
import { MOVEMENT_TYPES, useLocations } from '@/lib/hooks/use-inventory';
import {
  downloadReport,
  useDrilldown,
  useReport,
  useReportCatalogue,
  type ReportColumn,
  type ReportFilters,
  type ReportRow,
} from '@/lib/hooks/use-reports';
import { usePermission, useWorkspaceLocale } from '@/lib/session';
import { ReportTable } from './report-table';

type Preset = 'month' | 'week' | 'today' | 'custom';

/** The totals line of a list of records, added up exactly as decimals. */
function drilldownTotals(
  columns: ReportColumn[],
  rows: ReportRow[],
  decimals: number,
): Record<string, string> {
  return Object.fromEntries(
    columns
      .filter((c) => c.total)
      .map((c) => {
        const sum = rows.reduce(
          (acc, r) => acc.plus(new Decimal(String(r[c.key] ?? 0))),
          new Decimal(0),
        );
        return [c.key, c.type === 'money' ? sum.toFixed(decimals) : sum.toString()];
      }),
  );
}

/** One generic page for any report: its filters, rows, totals, drill-down and export (Requirements 19, 44). */
export function ReportView({ reportKey }: { reportKey: string }) {
  const t = useTranslations('reports');
  const message = useErrorMessage();
  const locale = useWorkspaceLocale();
  const canExport = usePermission('report:export');
  const canSeeStaff = usePermission('user:view');
  const catalogue = useReportCatalogue();
  const summary = catalogue.data?.find((r) => r.key === reportKey);
  const filterKeys = new Set(summary?.filters.map((f) => f.key));

  const [preset, setPreset] = useState<Preset>('month');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [other, setOther] = useState<ReportFilters>({});
  const [drilling, setDrilling] = useState<{ row: string; label: string } | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportError, setExportError] = useState<string | null>(null);

  const filters: ReportFilters = {
    ...other,
    ...(filterKeys.has('range')
      ? preset === 'custom'
        ? { from: from || undefined, to: to || undefined }
        : { range: preset }
      : {}),
  };
  // wait for the catalogue so the first request carries the right filters
  const ready = !!summary;
  const report = useReport(reportKey, filters, ready);
  const detail = useDrilldown(reportKey, filters, drilling ? drilling.row : null);

  const staff = useStaffQuery(filterKeys.has('salespersonId') && canSeeStaff).data ?? [];
  const categories = flattenCategories(useCategoriesQuery().data ?? []);
  const locations = (useLocations().data ?? []).filter((l) => l.active);

  const setFilter = (key: keyof ReportFilters, value: string) =>
    setOther((current) => ({ ...current, [key]: value || undefined }));

  async function exportCsv() {
    setExportError(null);
    setExporting(true);
    try {
      await downloadReport(reportKey, filters);
    } catch (e) {
      setExportError(message(e));
    } finally {
      setExporting(false);
    }
  }

  if (catalogue.isPending) return <p role="status">{t('loading')}</p>;
  if (catalogue.isSuccess && !summary) {
    return (
      <Alert tone="info">
        <p className="font-medium">{t('notAvailable')}</p>
        <Link href="/reports" className="underline">
          {t('back')}
        </Link>
      </Alert>
    );
  }
  const data = report.data;

  return (
    <div className="flex flex-col gap-4">
      <div>
        <Link href="/reports" className="text-sm underline">
          {t('back')}
        </Link>
        <h1 className="mt-2 text-2xl font-semibold">{summary?.title}</h1>
        <p className="text-sm text-neutral-600">{summary?.description}</p>
      </div>

      <form
        className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4"
        onSubmit={(e) => e.preventDefault()}
      >
        {filterKeys.has('range') ? (
          <>
            <Field id="rp-range" label={t('range')}>
              <Select
                id="rp-range"
                value={preset}
                onChange={(e) => setPreset(e.target.value as Preset)}
              >
                <option value="month">{t('thisMonth')}</option>
                <option value="week">{t('thisWeek')}</option>
                <option value="today">{t('today')}</option>
                <option value="custom">{t('custom')}</option>
              </Select>
            </Field>
            {preset === 'custom' ? (
              <>
                <Field id="rp-from" label={t('from')}>
                  <Input
                    id="rp-from"
                    type="date"
                    value={from}
                    onChange={(e) => setFrom(e.target.value)}
                  />
                </Field>
                <Field id="rp-to" label={t('to')}>
                  <Input
                    id="rp-to"
                    type="date"
                    value={to}
                    onChange={(e) => setTo(e.target.value)}
                  />
                </Field>
              </>
            ) : null}
          </>
        ) : null}
        {filterKeys.has('salespersonId') && staff.length > 0 ? (
          <Field id="rp-person" label={t('salesperson')}>
            <Select
              id="rp-person"
              value={other.salespersonId ?? ''}
              onChange={(e) => setFilter('salespersonId', e.target.value)}
            >
              <option value="">{t('everyone')}</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.firstName} {s.lastName}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        {filterKeys.has('categoryId') ? (
          <Field id="rp-category" label={t('category')}>
            <Select
              id="rp-category"
              value={other.categoryId ?? ''}
              onChange={(e) => setFilter('categoryId', e.target.value)}
            >
              <option value="">{t('all')}</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {'— '.repeat(c.depth)}
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        {filterKeys.has('locationId') ? (
          <Field id="rp-location" label={t('location')}>
            <Select
              id="rp-location"
              value={other.locationId ?? ''}
              onChange={(e) => setFilter('locationId', e.target.value)}
            >
              <option value="">{t('all')}</option>
              {locations.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}
        {filterKeys.has('status') ? (
          <Field id="rp-status" label={t('status')}>
            {reportKey === 'stock-movements' ? (
              <Select
                id="rp-status"
                value={other.status ?? ''}
                onChange={(e) => setFilter('status', e.target.value)}
              >
                <option value="">{t('all')}</option>
                {MOVEMENT_TYPES.map((m) => (
                  <option key={m} value={m}>
                    {m}
                  </option>
                ))}
              </Select>
            ) : (
              <Input
                id="rp-status"
                value={other.status ?? ''}
                onChange={(e) => setFilter('status', e.target.value)}
              />
            )}
          </Field>
        ) : null}
      </form>

      {report.isError ? <Alert>{message(report.error)}</Alert> : null}
      {exportError ? <Alert>{exportError}</Alert> : null}
      {data?.truncated ? <Alert tone="info">{t('truncated')}</Alert> : null}
      {report.isFetching && !data ? <p role="status">{t('loading')}</p> : null}

      {data ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-neutral-600">
              {t('period', { from: data.range.from, to: data.range.to })}
            </p>
            <div className="flex gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setDrilling({ row: '', label: t('allRecords') })}
              >
                {t('allRecords')}
              </Button>
              {canExport ? (
                <Button
                  type="button"
                  size="sm"
                  disabled={exporting}
                  onClick={() => void exportCsv()}
                >
                  {t('export')}
                </Button>
              ) : null}
            </div>
          </div>
          <ReportTable
            caption={data.title}
            columns={data.columns}
            rows={data.rows}
            totals={data.totals}
            onDrill={(row: ReportRow) =>
              setDrilling({
                row: row.key,
                label: String(row[data.columns[0]?.key ?? 'key'] ?? row.key),
              })
            }
          />
        </>
      ) : null}

      {drilling ? (
        <Modal
          open
          title={t('recordsFor', { label: drilling.label })}
          onClose={() => setDrilling(null)}
          wide
        >
          {detail.isError ? <Alert>{message(detail.error)}</Alert> : null}
          {detail.isPending ? <p role="status">{t('loading')}</p> : null}
          {detail.data ? (
            <>
              {detail.data.truncated ? <Alert tone="info">{t('truncated')}</Alert> : null}
              <ReportTable
                caption={t('recordsFor', { label: drilling.label })}
                columns={detail.data.columns}
                rows={detail.data.rows}
                totals={drilldownTotals(
                  detail.data.columns,
                  detail.data.rows,
                  locale.currencyDecimals,
                )}
              />
            </>
          ) : null}
        </Modal>
      ) : null}
    </div>
  );
}
