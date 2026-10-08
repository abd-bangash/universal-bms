'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { DataTable, type Column } from '@/components/data-table/data-table';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { api } from '@/lib/api-client';
import { formatDateTime } from '@/lib/format';
import { useWorkspaceLocale, usePermission } from '@/lib/session';

export interface AuditEvent {
  id: string;
  actorUserId: string | null;
  actorType: string;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string;
  previousState: Record<string, unknown> | null;
  newState: Record<string, unknown> | null;
  metadata: unknown;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  createdAt: string;
}

interface Filters {
  entityType: string;
  entityId: string;
  actorUserId: string;
  action: string;
  from: string;
  to: string;
}
const EMPTY: Filters = {
  entityType: '',
  entityId: '',
  actorUserId: '',
  action: '',
  from: '',
  to: '',
};

/** `2026-03-04` (the user's day) to the instant that day starts or ends in the workspace timezone. */
export function dayBoundary(day: string, end: boolean, timezone: string): string | undefined {
  if (!day) return undefined;
  // Find the UTC instant at which the given calendar day begins in the timezone by correcting for the offset.
  const guess = new Date(`${day}T${end ? '23:59:59.999' : '00:00:00.000'}Z`);
  const shown = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(guess);
  const get = (type: string) => Number(shown.find((p) => p.type === type)?.value);
  const asLocal = Date.UTC(
    get('year'),
    get('month') - 1,
    get('day'),
    get('hour'),
    get('minute'),
    get('second'),
  );
  const offset = asLocal - Math.floor(guess.getTime() / 1000) * 1000;
  return new Date(guess.getTime() - offset).toISOString();
}

export function AuditViewer() {
  const t = useTranslations('settings.audit');
  const locale = useWorkspaceLocale();
  const canSeeStaff = usePermission('user:view');
  const [draft, setDraft] = useState<Filters>(EMPTY);
  const [applied, setApplied] = useState<Filters>(EMPTY);
  const [selected, setSelected] = useState<AuditEvent | null>(null);

  const staff = useQuery({
    queryKey: ['audit-people'],
    queryFn: () =>
      api.getPage<{ id: string; firstName: string; lastName: string }>('/users', { limit: 100 }),
    enabled: canSeeStaff,
  });
  const names = useMemo(
    () => new Map((staff.data?.items ?? []).map((u) => [u.id, `${u.firstName} ${u.lastName}`])),
    [staff.data],
  );
  const who = (event: AuditEvent): string => {
    if (event.actorUserId) return names.get(event.actorUserId) ?? event.actorUserId;
    return event.actorType === 'USER' ? t('unknownPerson') : t('system');
  };

  const params = {
    entityType: applied.entityType || undefined,
    entityId: applied.entityId || undefined,
    actorUserId: applied.actorUserId || undefined,
    action: applied.action || undefined,
    from: dayBoundary(applied.from, false, locale.timezone),
    to: dayBoundary(applied.to, true, locale.timezone),
  };

  const columns: Array<Column<AuditEvent>> = [
    {
      key: 'when',
      header: t('when'),
      cell: (e) => <span className="whitespace-nowrap">{formatDateTime(e.createdAt, locale)}</span>,
    },
    { key: 'who', header: t('who'), cell: (e) => who(e) },
    { key: 'action', header: t('what'), cell: (e) => <code className="text-xs">{e.action}</code> },
    { key: 'record', header: t('record'), cell: (e) => `${e.entityType} ${e.entityId}` },
    {
      key: 'details',
      header: t('details'),
      cell: (e) => (
        <Button type="button" variant="outline" size="sm" onClick={() => setSelected(e)}>
          {t('viewDetails')}
        </Button>
      ),
    },
  ];

  const set = (key: keyof Filters) => (value: string) =>
    setDraft((prev) => ({ ...prev, [key]: value }));

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <form
        className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6 lg:items-end"
        onSubmit={(event) => {
          event.preventDefault();
          setApplied(draft);
        }}
      >
        <Field id="audit-entityType" label={t('entityType')}>
          <Input
            id="audit-entityType"
            value={draft.entityType}
            onChange={(e) => set('entityType')(e.target.value)}
            placeholder="Order"
          />
        </Field>
        <Field id="audit-entityId" label={t('entityId')}>
          <Input
            id="audit-entityId"
            value={draft.entityId}
            onChange={(e) => set('entityId')(e.target.value)}
          />
        </Field>
        <Field id="audit-actor" label={t('actor')}>
          <Input
            id="audit-actor"
            value={draft.actorUserId}
            onChange={(e) => set('actorUserId')(e.target.value)}
            list="audit-people"
          />
          <datalist id="audit-people">
            {[...names].map(([id, name]) => (
              <option key={id} value={id}>
                {name}
              </option>
            ))}
          </datalist>
        </Field>
        <Field id="audit-action" label={t('action')}>
          <Input
            id="audit-action"
            value={draft.action}
            onChange={(e) => set('action')(e.target.value)}
            placeholder="order.create"
          />
        </Field>
        <Field id="audit-from" label={t('from')}>
          <Input
            id="audit-from"
            type="date"
            value={draft.from}
            onChange={(e) => set('from')(e.target.value)}
          />
        </Field>
        <Field id="audit-to" label={t('to')}>
          <Input
            id="audit-to"
            type="date"
            value={draft.to}
            onChange={(e) => set('to')(e.target.value)}
          />
        </Field>
        <Button type="submit" className="lg:col-span-1">
          {t('apply')}
        </Button>
      </form>

      <DataTable<AuditEvent>
        queryKey="audit"
        endpoint="/audit/events"
        caption={t('caption')}
        columns={columns}
        rowKey={(e) => e.id}
        searchable={false}
        params={params}
        pageSize={25}
      />

      <Modal
        open={selected !== null}
        title={t('detailsTitle')}
        onClose={() => setSelected(null)}
        wide
      >
        {selected ? (
          <EventDetails
            event={selected}
            who={who(selected)}
            when={formatDateTime(selected.createdAt, locale)}
          />
        ) : null}
      </Modal>
    </div>
  );
}

const show = (value: unknown): string =>
  value === undefined ? '' : typeof value === 'string' ? value : JSON.stringify(value);

export function EventDetails({
  event,
  who,
  when,
}: {
  event: AuditEvent;
  who: string;
  when: string;
}) {
  const t = useTranslations('settings.audit');
  const keys = [
    ...new Set([...Object.keys(event.previousState ?? {}), ...Object.keys(event.newState ?? {})]),
  ].sort();
  return (
    <div className="flex flex-col gap-3 text-sm">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-neutral-600">{t('when')}</dt>
        <dd>{when}</dd>
        <dt className="text-neutral-600">{t('who')}</dt>
        <dd>
          {who}
          {event.actorRole ? ` (${event.actorRole})` : ''}
        </dd>
        <dt className="text-neutral-600">{t('what')}</dt>
        <dd>
          <code>{event.action}</code>
        </dd>
        <dt className="text-neutral-600">{t('record')}</dt>
        <dd>
          {event.entityType} {event.entityId}
        </dd>
        {event.ipAddress ? (
          <>
            <dt className="text-neutral-600">{t('ip')}</dt>
            <dd>{event.ipAddress}</dd>
          </>
        ) : null}
        {event.requestId ? (
          <>
            <dt className="text-neutral-600">{t('requestId')}</dt>
            <dd className="font-mono text-xs">{event.requestId}</dd>
          </>
        ) : null}
      </dl>
      {keys.length === 0 ? (
        <p className="text-neutral-600">{t('noChanges')}</p>
      ) : (
        <table className="w-full text-left">
          <thead className="text-xs uppercase text-neutral-600">
            <tr>
              <th scope="col" className="py-1 pr-3 font-medium">
                {t('field')}
              </th>
              <th scope="col" className="py-1 pr-3 font-medium">
                {t('before')}
              </th>
              <th scope="col" className="py-1 font-medium">
                {t('after')}
              </th>
            </tr>
          </thead>
          <tbody>
            {keys.map((key) => (
              <tr key={key} className="border-t border-neutral-100 align-top">
                <th scope="row" className="py-1 pr-3 font-mono text-xs font-normal">
                  {key}
                </th>
                <td className="py-1 pr-3 break-all text-red-800">
                  {show(event.previousState?.[key])}
                </td>
                <td className="py-1 break-all text-green-800">{show(event.newState?.[key])}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
