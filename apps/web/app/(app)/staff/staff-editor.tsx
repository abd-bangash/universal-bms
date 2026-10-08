'use client';

import { useEffect, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import { FormShell } from '@/components/forms/form-shell';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { CopyField } from '@/components/ui/copy-field';
import { Input } from '@/components/ui/input';
import { Field, describedBy } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { api } from '@/lib/api-client';
import { useErrorMessage } from '@/lib/error-message';
import { useRolesQuery } from '@/lib/hooks/use-roles';
import { usePermission } from '@/lib/session';
import type { StaffMember } from './staff-list';

interface ProfileForm {
  firstName: string;
  lastName: string;
  phone: string;
  jobTitle: string;
  employeeCode: string;
  joinDate: string;
  isSalesperson: boolean;
}

const toForm = (m: StaffMember): ProfileForm => ({
  firstName: m.firstName,
  lastName: m.lastName,
  phone: m.phone ?? '',
  jobTitle: m.jobTitle ?? '',
  employeeCode: m.employeeCode ?? '',
  joinDate: m.joinDate ? m.joinDate.slice(0, 10) : '',
  isSalesperson: m.isSalesperson,
});

export function StaffEditor({
  member,
  onClose,
  onChanged,
}: {
  member: StaffMember | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  return (
    <Modal
      open={member !== null}
      title={member ? `${member.firstName} ${member.lastName}` : ''}
      onClose={onClose}
      wide
    >
      {member ? (
        <EditorBody key={member.id} member={member} onClose={onClose} onChanged={onChanged} />
      ) : null}
    </Modal>
  );
}

function EditorBody({
  member,
  onClose,
  onChanged,
}: {
  member: StaffMember;
  onClose: () => void;
  onChanged: () => void;
}) {
  const t = useTranslations('staff');
  const message = useErrorMessage();
  const canEdit = usePermission('user:edit');
  const canDeactivate = usePermission('user:deactivate');
  const canConfigureRoles = usePermission('role:configure');
  const canSeeRoles = usePermission('role:view');
  const roles = useRolesQuery(canSeeRoles);
  const name = `${member.firstName} ${member.lastName}`;

  const [current, setCurrent] = useState(member);
  const [roleIds, setRoleIds] = useState(member.roles.map((r) => r.id));
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmingDeactivate, setConfirmingDeactivate] = useState(false);
  const [resetToken, setResetToken] = useState<string | null>(null);

  const form = useForm<ProfileForm>({ defaultValues: toForm(member) });
  const { errors } = form.formState;

  useEffect(() => {
    form.reset(toForm(current));
  }, [current, form]);

  const rolesChanged =
    JSON.stringify([...roleIds].sort()) !== JSON.stringify(current.roles.map((r) => r.id).sort());

  async function save(values: ProfileForm) {
    const body: Record<string, unknown> = {
      firstName: values.firstName,
      lastName: values.lastName,
      phone: values.phone,
      jobTitle: values.jobTitle,
      employeeCode: values.employeeCode,
      joinDate: values.joinDate === '' ? null : values.joinDate,
      isSalesperson: values.isSalesperson,
    };
    if (canConfigureRoles && rolesChanged) body.roleIds = roleIds;
    const updated = await api.patch<StaffMember>(`/users/${member.id}`, body);
    setCurrent(updated);
    setRoleIds(updated.roles.map((r) => r.id));
    setNotice(t('saved'));
    onChanged();
  }

  const setStatus = useMutation({
    mutationFn: (action: 'deactivate' | 'reactivate') =>
      api.post<StaffMember>(`/users/${member.id}/${action}`),
    onSuccess: (updated, action) => {
      setCurrent(updated);
      setConfirmingDeactivate(false);
      setNotice(t(action === 'deactivate' ? 'deactivated' : 'reactivated', { name }));
      onChanged();
    },
  });
  const resetLink = useMutation({
    mutationFn: () =>
      api.post<{ token: string; expiresAt: string }>(`/users/${member.id}/reset-link`),
    onSuccess: (data) => setResetToken(data.token),
  });

  const inactive = current.status === 'INACTIVE';
  const field = (id: keyof ProfileForm, label: string, type = 'text') => (
    <Field id={`staff-${id}`} label={label} error={errors[id]?.message}>
      <Input
        {...describedBy(`staff-${id}`, { error: errors[id]?.message })}
        type={type}
        disabled={!canEdit}
        {...form.register(id as Exclude<keyof ProfileForm, 'isSalesperson'>)}
      />
    </Field>
  );

  return (
    <div className="flex flex-col gap-6">
      <p className="text-sm text-neutral-600">{current.email}</p>
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {setStatus.isError ? <Alert>{message(setStatus.error)}</Alert> : null}
      {resetLink.isError ? <Alert>{message(resetLink.error)}</Alert> : null}

      <FormShell
        form={form}
        onSubmit={save}
        submitLabel={t('save')}
        hideSubmit={!canEdit}
        className="flex flex-col gap-4"
        actions={
          <Button type="button" variant="outline" onClick={onClose}>
            {t('close')}
          </Button>
        }
      >
        <h3 className="font-medium">{t('profile')}</h3>
        <div className="grid gap-3 sm:grid-cols-2">
          {field('firstName', t('firstName'))}
          {field('lastName', t('lastName'))}
          {field('phone', t('phone'), 'tel')}
          {field('jobTitle', t('jobTitle'))}
          {field('employeeCode', t('employeeCode'))}
          {field('joinDate', t('joinDate'), 'date')}
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" disabled={!canEdit} {...form.register('isSalesperson')} />{' '}
          {t('isSalesperson')}
        </label>

        {canSeeRoles ? (
          <fieldset className="flex flex-col gap-1">
            <legend className="font-medium">{t('rolesHeading')}</legend>
            <p className="text-xs text-neutral-600">
              {canConfigureRoles ? t('rolesHint') : t('rolesNeedPermission')}
            </p>
            {roles.data?.map((role) => (
              <label key={role.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  disabled={!canEdit || !canConfigureRoles}
                  checked={roleIds.includes(role.id)}
                  onChange={(e) =>
                    setRoleIds((prev) =>
                      e.target.checked ? [...prev, role.id] : prev.filter((id) => id !== role.id),
                    )
                  }
                />
                {role.name}
              </label>
            ))}
          </fieldset>
        ) : null}
      </FormShell>

      <div className="flex flex-wrap gap-2 border-t border-neutral-200 pt-4">
        {canDeactivate ? (
          inactive ? (
            <Button
              type="button"
              variant="outline"
              disabled={setStatus.isPending}
              onClick={() => setStatus.mutate('reactivate')}
            >
              {t('reactivate')}
            </Button>
          ) : (
            <Button
              type="button"
              variant="outline"
              disabled={setStatus.isPending}
              onClick={() => setConfirmingDeactivate(true)}
            >
              {t('deactivate')}
            </Button>
          )
        ) : null}
        {canEdit ? (
          <Button
            type="button"
            variant="outline"
            disabled={resetLink.isPending}
            onClick={() => resetLink.mutate()}
          >
            {t('resetLink')}
          </Button>
        ) : null}
      </div>

      {resetToken ? (
        <div className="flex flex-col gap-2 rounded-md border border-neutral-200 p-3">
          <p className="text-sm font-medium">{t('resetLinkTitle')}</p>
          <p className="text-xs text-neutral-600">{t('resetLinkHint', { name })}</p>
          <CopyField
            label={t('resetLinkTitle')}
            value={`${window.location.origin}/reset-password?token=${resetToken}`}
          />
        </div>
      ) : null}

      <ConfirmDialog
        open={confirmingDeactivate}
        destructive
        title={t('deactivateTitle', { name })}
        description={t('deactivateDescription')}
        confirmLabel={t('deactivate')}
        pending={setStatus.isPending}
        onConfirm={() => setStatus.mutate('deactivate')}
        onCancel={() => setConfirmingDeactivate(false)}
      />
    </div>
  );
}
