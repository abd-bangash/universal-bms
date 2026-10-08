'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { CopyField } from '@/components/ui/copy-field';
import { Input } from '@/components/ui/input';
import { Field, describedBy } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { api } from '@/lib/api-client';
import { ApiError } from '@/lib/errors';
import { useErrorMessage } from '@/lib/error-message';
import { useRolesQuery } from '@/lib/hooks/use-roles';
import { usePermission } from '@/lib/session';

interface Invitation {
  id: string;
  email: string;
  token: string;
  expiresAt: string;
}

/**
 * Creates an invitation. No email provider exists in Release 1, so the link is shown once for the
 * inviter to pass on.
 */
export function InviteDialog({
  open,
  onClose,
  onInvited,
}: {
  open: boolean;
  onClose: () => void;
  onInvited: () => void;
}) {
  const t = useTranslations('staff');
  const message = useErrorMessage();
  const canSeeRoles = usePermission('role:view');
  const roles = useRolesQuery(canSeeRoles && open);
  const [email, setEmail] = useState('');
  const [chosen, setChosen] = useState<string[]>([]);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [created, setCreated] = useState<Invitation | null>(null);

  const invite = useMutation({
    mutationFn: () => api.post<Invitation>('/users/invite', { email, roleIds: chosen }),
    onSuccess: (data) => {
      setCreated(data);
      onInvited();
    },
    onError: (error) => {
      setFieldErrors(
        error instanceof ApiError && error.details
          ? Object.fromEntries(Object.entries(error.details).map(([k, v]) => [k, v[0] ?? '']))
          : {},
      );
    },
  });

  function close() {
    setEmail('');
    setChosen([]);
    setFieldErrors({});
    setCreated(null);
    invite.reset();
    onClose();
  }

  const link =
    created && typeof window !== 'undefined'
      ? `${window.location.origin}/invite/${created.token}`
      : '';
  const emailError = fieldErrors.email;
  const rolesError =
    fieldErrors.roleIds ?? (invite.isError && chosen.length === 0 ? t('inviteNoRoles') : undefined);

  return (
    <Modal open={open} title={created ? t('inviteReady') : t('inviteTitle')} onClose={close}>
      {created ? (
        <div className="flex flex-col gap-4">
          <p className="text-sm text-neutral-700">
            {t('inviteLinkHint', { email: created.email })}
          </p>
          <CopyField label={t('inviteReady')} value={link} />
          <div>
            <Button type="button" onClick={close}>
              {t('close')}
            </Button>
          </div>
        </div>
      ) : (
        <form
          noValidate
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            setFieldErrors({});
            invite.mutate();
          }}
        >
          {invite.isError && Object.keys(fieldErrors).length === 0 ? (
            <Alert>{message(invite.error)}</Alert>
          ) : null}
          <Field id="invite-email" label={t('inviteEmail')} error={emailError}>
            <Input
              {...describedBy('invite-email', { error: emailError })}
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </Field>
          <fieldset className="flex flex-col gap-1">
            <legend className="mb-1 text-sm font-medium">{t('inviteRoles')}</legend>
            {roles.data?.map((role) => (
              <label key={role.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={chosen.includes(role.id)}
                  onChange={(e) =>
                    setChosen((prev) =>
                      e.target.checked ? [...prev, role.id] : prev.filter((id) => id !== role.id),
                    )
                  }
                />
                {role.name}
              </label>
            ))}
            {rolesError ? (
              <p role="alert" className="text-xs text-red-700">
                {rolesError}
              </p>
            ) : null}
          </fieldset>
          <div className="flex gap-2">
            <Button type="submit" disabled={invite.isPending}>
              {invite.isPending ? t('inviteSend') + '…' : t('inviteSend')}
            </Button>
            <Button type="button" variant="outline" onClick={close}>
              {t('close')}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
