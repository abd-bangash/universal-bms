'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { NotesPanel } from '@/components/crm/notes-panel';
import { TasksPanel } from '@/components/crm/tasks-panel';
import { TimelinePanel } from '@/components/crm/timeline-panel';
import { FileUpload } from '@/components/forms/file-upload';
import { SignedImage } from '@/components/forms/signed-image';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { StatusBadge } from '@/components/ui/status-badge';
import { api } from '@/lib/api-client';
import { useErrorMessage } from '@/lib/error-message';
import { formatDate } from '@/lib/format';
import {
  useStaffQuery,
  type CustomerView,
  type LeadView,
  type PipelineColumn,
} from '@/lib/hooks/use-crm';
import { usePermission, useWorkspaceLocale } from '@/lib/session';
import { LeadForm } from './lead-form';
import { useLeadMove } from './lead-move';

interface Attachment {
  id: string;
  name: string;
  mime: string;
}

/** One lead: stage, assignment, requirements, reference images, tasks, notes and history (Requirements 9.2-9.5). */
export function LeadDetail({ leadId }: { leadId: string }) {
  const t = useTranslations('leads.detail');
  const message = useErrorMessage();
  const locale = useWorkspaceLocale();
  const queryClient = useQueryClient();
  const canEdit = usePermission('lead:edit');
  const canAssign = usePermission('lead:assign');
  const canSeeStaff = usePermission('user:view');
  const staff = useStaffQuery(canAssign && canSeeStaff);
  const [actionError, setActionError] = useState<string | null>(null);
  const [converted, setConverted] = useState<{ customer: CustomerView; created: boolean } | null>(
    null,
  );

  const lead = useQuery({
    queryKey: ['lead', leadId],
    queryFn: ({ signal }) => api.get<LeadView>(`/leads/${leadId}`, undefined, signal),
  });
  const board = useQuery({
    queryKey: ['pipeline'],
    queryFn: ({ signal }) => api.get<PipelineColumn[]>('/leads/pipeline', undefined, signal),
  });
  const attachments = useQuery({
    queryKey: ['lead', leadId, 'attachments'],
    queryFn: ({ signal }) =>
      api.get<Attachment[]>(`/leads/${leadId}/attachments`, undefined, signal),
  });
  const columns = board.data ?? [];
  const {
    move,
    dialog,
    error: moveError,
  } = useLeadMove({
    lostStage: (stage) => columns.find((c) => c.stage === stage)?.systemRole === 'LOST',
  });

  if (lead.isPending) return <p role="status">…</p>;
  if (lead.isError) return <Alert>{message(lead.error)}</Alert>;
  const l = lead.data;
  const stage = columns.find((c) => c.stage === l.stage);
  const nextStages = l.allowedTransitions ?? [];

  async function assign(assignedToId: string) {
    setActionError(null);
    try {
      await api.post(`/leads/${leadId}/assign`, { assignedToId: assignedToId || null });
      await queryClient.invalidateQueries({ queryKey: ['lead'] });
      await queryClient.invalidateQueries({ queryKey: ['timeline'] });
    } catch (e) {
      setActionError(message(e));
    }
  }

  async function convert(createNew = false) {
    setActionError(null);
    try {
      const result = await api.post<{ customer: CustomerView; created: boolean }>(
        `/leads/${leadId}/convert`,
        { target: 'CUSTOMER', ...(createNew ? { createNew: true } : {}) },
      );
      setConverted(result);
      await queryClient.invalidateQueries({ queryKey: ['lead'] });
      await queryClient.invalidateQueries({ queryKey: ['timeline'] });
    } catch (e) {
      setActionError(message(e));
    }
  }

  return (
    <div className="flex max-w-5xl flex-col gap-6">
      <div>
        <Link href="/leads" className="text-sm underline">
          {t('back')}
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-2xl font-semibold">{l.fullName}</h1>
          <StatusBadge label={stage?.label ?? l.stage} color={stage?.color} />
          {l.closedAt ? (
            <span className="text-sm text-neutral-600">
              {t('closed', { date: formatDate(l.closedAt, locale) })}
            </span>
          ) : null}
        </div>
      </div>

      {moveError ? <Alert>{moveError}</Alert> : null}
      {actionError ? <Alert>{actionError}</Alert> : null}

      <section aria-labelledby="lead-stage" className="flex flex-col gap-2">
        <h2 id="lead-stage" className="font-medium">
          {t('stage')}
        </h2>
        {canEdit && nextStages.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-sm text-neutral-600">{t('moveTo')}:</span>
            {nextStages.map((next) => {
              const target = columns.find((c) => c.stage === next.to);
              return (
                <Button
                  key={next.to}
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void move(leadId, next.to)}
                >
                  {target?.label ?? next.to}
                </Button>
              );
            })}
          </div>
        ) : null}
      </section>

      {canAssign && canSeeStaff ? (
        <div className="flex max-w-xs flex-col gap-1">
          <Label htmlFor="lead-assignee">{t('assign')}</Label>
          <Select
            id="lead-assignee"
            value={l.assignedToId ?? ''}
            onChange={(e) => void assign(e.target.value)}
          >
            <option value="" />
            {(staff.data ?? []).map((s) => (
              <option key={s.id} value={s.id}>
                {s.firstName} {s.lastName}
              </option>
            ))}
          </Select>
        </div>
      ) : null}

      {canEdit ? (
        <section aria-labelledby="lead-convert" className="flex flex-col gap-2">
          <h2 id="lead-convert" className="sr-only">
            {t('convert')}
          </h2>
          {l.customerId || converted ? (
            <p className="text-sm">
              <Link
                href={`/customers/${converted?.customer.id ?? l.customerId}`}
                className="underline"
              >
                {t('openCustomer')}
              </Link>
              {converted
                ? ` — ${converted.created ? t('convertCreated') : t('convertLinked')}`
                : null}
            </p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => void convert()}>
                {t('convert')}
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => void convert(true)}>
                {t('createNewCustomer')}
              </Button>
            </div>
          )}
        </section>
      ) : null}

      <LeadForm key={`${l.id}-${l.version}`} lead={l} />

      <section aria-labelledby="lead-files" className="flex flex-col gap-3">
        <h2 id="lead-files" className="font-medium">
          {t('attachments')}
        </h2>
        {attachments.isSuccess && attachments.data.length === 0 ? (
          <p className="text-sm text-neutral-600">{t('noAttachments')}</p>
        ) : null}
        <ul className="flex flex-wrap gap-3">
          {(attachments.data ?? [])
            .filter((a) => a.mime.startsWith('image/'))
            .map((a) => (
              <li key={a.id}>
                <SignedImage fileId={a.id} alt={a.name} />
              </li>
            ))}
        </ul>
        {canEdit ? (
          <FileUpload
            label={t('addAttachment')}
            accept="image/jpeg,image/png,image/webp"
            entityType="LEAD"
            entityId={leadId}
            purpose="reference"
            onUploaded={() =>
              void queryClient.invalidateQueries({ queryKey: ['lead', leadId, 'attachments'] })
            }
          />
        ) : null}
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <TasksPanel entityType="LEAD" entityId={leadId} />
        <NotesPanel entityType="LEAD" entityId={leadId} canWrite={canEdit} />
      </div>
      <TimelinePanel path={`/leads/${leadId}/timeline`} queryKey={[leadId]} />
      {dialog}
    </div>
  );
}
