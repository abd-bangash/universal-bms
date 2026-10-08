'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Select } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/status-badge';
import { api } from '@/lib/api-client';
import { useErrorMessage } from '@/lib/error-message';
import { ROLES_QUERY_KEY, useRolesQuery, type RoleView } from '@/lib/hooks/use-roles';
import { usePermission } from '@/lib/session';
import { RoleEditor } from './role-editor';

export function RolesManager() {
  const t = useTranslations('roles');
  const message = useErrorMessage();
  const queryClient = useQueryClient();
  const canConfigure = usePermission('role:configure');
  const roles = useRolesQuery();
  const [editing, setEditing] = useState<RoleView | 'new' | null>(null);
  const [deleting, setDeleting] = useState<RoleView | null>(null);
  const [fallbackId, setFallbackId] = useState('');
  const [notice, setNotice] = useState<string | null>(null);

  const remove = useMutation({
    mutationFn: ({ id, fallback }: { id: string; fallback: string }) =>
      api.delete(`/roles/${id}`, { fallbackRoleId: fallback }),
    onSuccess: async () => {
      setDeleting(null);
      setNotice(t('deleted'));
      await queryClient.invalidateQueries({ queryKey: ROLES_QUERY_KEY });
      await queryClient.invalidateQueries({ queryKey: ['list', 'staff'] });
    },
  });

  const fallbackChoices = roles.data?.filter((r) => r.id !== deleting?.id && !r.isOwner) ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        {canConfigure ? (
          <Button type="button" onClick={() => setEditing('new')}>
            {t('new')}
          </Button>
        ) : null}
      </div>
      {notice ? <Alert tone="success">{notice}</Alert> : null}
      {roles.isError ? <Alert>{message(roles.error)}</Alert> : null}
      {remove.isError ? <Alert>{message(remove.error)}</Alert> : null}

      <div className="overflow-x-auto rounded-md border border-neutral-200 bg-white">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{t('caption')}</caption>
          <thead className="bg-neutral-50 text-xs uppercase text-neutral-600">
            <tr>
              <th scope="col" className="px-3 py-2 font-medium">
                {t('name')}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {t('permissions')}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {t('maxDiscount')}
              </th>
              <th scope="col" className="px-3 py-2 font-medium">
                {t('members')}
              </th>
              <th scope="col" className="px-3 py-2">
                <span className="sr-only">{t('delete')}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {roles.data?.map((role) => (
              <tr key={role.id} className="border-t border-neutral-100">
                <td className="px-3 py-2">
                  <button
                    type="button"
                    className="font-medium underline-offset-2 hover:underline"
                    onClick={() => setEditing(role)}
                  >
                    {role.name}
                  </button>{' '}
                  <StatusBadge
                    label={role.isSystem ? t('system') : t('custom')}
                    color={role.isSystem ? '#64748b' : '#0ea5e9'}
                  />
                </td>
                <td className="px-3 py-2">{role.permissions.length}</td>
                <td className="px-3 py-2 tabular-nums">{role.maxDiscountPercent}</td>
                <td className="px-3 py-2">{role.memberCount}</td>
                <td className="px-3 py-2 text-right">
                  {canConfigure && !role.isSystem ? (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => {
                        setFallbackId('');
                        setDeleting(role);
                      }}
                    >
                      {t('delete')}
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <RoleEditor
        role={editing}
        onClose={() => setEditing(null)}
        onSaved={(created) => {
          setNotice(created ? t('created') : t('saved'));
          setEditing(null);
        }}
      />

      <ConfirmDialog
        open={deleting !== null}
        destructive
        title={t('deleteTitle', { name: deleting?.name ?? '' })}
        description={
          <div className="flex flex-col gap-2">
            <p>{t('deleteDescription')}</p>
            <label className="flex flex-col gap-1">
              <span className="font-medium">{t('fallback')}</span>
              <Select value={fallbackId} onChange={(e) => setFallbackId(e.target.value)}>
                <option value="" />
                {fallbackChoices.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </Select>
            </label>
          </div>
        }
        confirmLabel={t('delete')}
        pending={remove.isPending || fallbackId === ''}
        onConfirm={() =>
          deleting && fallbackId && remove.mutate({ id: deleting.id, fallback: fallbackId })
        }
        onCancel={() => setDeleting(null)}
      />
    </div>
  );
}
