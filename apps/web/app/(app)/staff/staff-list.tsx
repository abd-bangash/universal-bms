'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { DataTable, type Column, type FilterDefinition } from '@/components/data-table/data-table';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/status-badge';
import { useRolesQuery } from '@/lib/hooks/use-roles';
import { usePermission } from '@/lib/session';
import { InviteDialog } from './invite-dialog';
import { StaffEditor } from './staff-editor';

export interface StaffMember {
  id: string;
  membershipId: string;
  email: string;
  firstName: string;
  lastName: string;
  status: 'ACTIVE' | 'INACTIVE' | 'PENDING';
  phone: string | null;
  jobTitle: string | null;
  employeeCode: string | null;
  joinDate: string | null;
  isSalesperson: boolean;
  defaultLocationId: string | null;
  roles: Array<{ id: string; name: string }>;
}

const STATUS_COLOR: Record<StaffMember['status'], string> = {
  ACTIVE: '#16a34a',
  INACTIVE: '#a3a3a3',
  PENDING: '#f59e0b',
};

export function StaffList() {
  const t = useTranslations('staff');
  const queryClient = useQueryClient();
  const canInvite = usePermission('user:create');
  const canSeeRoles = usePermission('role:view');
  const roles = useRolesQuery(canSeeRoles);
  const [editing, setEditing] = useState<StaffMember | null>(null);
  const [inviting, setInviting] = useState(false);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['list', 'staff'] });

  const columns: Array<Column<StaffMember>> = [
    {
      key: 'name',
      header: t('name'),
      cell: (m) => (
        <button
          type="button"
          className="text-left font-medium underline-offset-2 hover:underline"
          onClick={() => setEditing(m)}
        >
          {m.firstName} {m.lastName}
        </button>
      ),
    },
    { key: 'email', header: t('email'), cell: (m) => <span className="break-all">{m.email}</span> },
    { key: 'roles', header: t('roles'), cell: (m) => m.roles.map((r) => r.name).join(', ') },
    {
      key: 'status',
      header: t('status'),
      cell: (m) => (
        <StatusBadge label={t(`statusLabels.${m.status}`)} color={STATUS_COLOR[m.status]} />
      ),
    },
  ];

  const filters: FilterDefinition[] = [
    {
      key: 'status',
      label: t('filterStatus'),
      options: [
        { value: 'ACTIVE', label: t('statusLabels.ACTIVE') },
        { value: 'INACTIVE', label: t('statusLabels.INACTIVE') },
      ],
    },
    ...(roles.data
      ? [
          {
            key: 'roleId',
            label: t('filterRole'),
            options: roles.data.map((r) => ({ value: r.id, label: r.name })),
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        {canInvite ? (
          <Button type="button" onClick={() => setInviting(true)}>
            {t('invite')}
          </Button>
        ) : null}
      </div>
      <DataTable<StaffMember>
        queryKey="staff"
        endpoint="/users"
        caption={t('caption')}
        columns={columns}
        rowKey={(m) => m.id}
        filters={filters}
        emptyTitle={t('empty')}
        emptyDescription={t('emptyDescription')}
      />
      <StaffEditor member={editing} onClose={() => setEditing(null)} onChanged={refresh} />
      <InviteDialog open={inviting} onClose={() => setInviting(false)} onInvited={refresh} />
    </div>
  );
}
