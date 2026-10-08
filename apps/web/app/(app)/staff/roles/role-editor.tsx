'use client';

import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, describedBy } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { api } from '@/lib/api-client';
import { ApiError } from '@/lib/errors';
import { useErrorMessage } from '@/lib/error-message';
import { ROLES_QUERY_KEY, useCatalogueQuery, type RoleView } from '@/lib/hooks/use-roles';
import { usePermission } from '@/lib/session';

export function RoleEditor({
  role,
  onClose,
  onSaved,
}: {
  role: RoleView | 'new' | null;
  onClose: () => void;
  onSaved: (created: boolean) => void;
}) {
  const t = useTranslations('roles');
  const title = role === 'new' ? t('newTitle') : role ? t('editTitle', { name: role.name }) : '';
  return (
    <Modal open={role !== null} title={title} onClose={onClose} wide>
      {role ? (
        <Body
          key={role === 'new' ? 'new' : role.id}
          role={role}
          onClose={onClose}
          onSaved={onSaved}
        />
      ) : null}
    </Modal>
  );
}

function Body({
  role,
  onClose,
  onSaved,
}: {
  role: RoleView | 'new';
  onClose: () => void;
  onSaved: (created: boolean) => void;
}) {
  const t = useTranslations('roles');
  const tp = useTranslations('permissions');
  const tm = useTranslations('modal');
  const message = useErrorMessage();
  const queryClient = useQueryClient();
  const canConfigure = usePermission('role:configure');
  const catalogue = useCatalogueQuery();
  const isNew = role === 'new';
  const readOnly = !canConfigure || (!isNew && role.isOwner);

  const [name, setName] = useState(isNew ? '' : role.name);
  const [discount, setDiscount] = useState(isNew ? '0' : role.maxDiscountPercent);
  const [granted, setGranted] = useState<Set<string>>(new Set(isNew ? [] : role.permissions));
  const [errors, setErrors] = useState<Record<string, string>>({});

  const save = useMutation({
    mutationFn: () => {
      const body = {
        name: name.trim(),
        permissions: [...granted].sort(),
        maxDiscountPercent: Number(discount),
      };
      return isNew
        ? api.post<RoleView>('/roles', body)
        : api.patch<RoleView>(`/roles/${role.id}`, body);
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ROLES_QUERY_KEY });
      onSaved(isNew);
    },
    onError: (error) => {
      setErrors(
        error instanceof ApiError && error.details
          ? Object.fromEntries(Object.entries(error.details).map(([k, v]) => [k, v[0] ?? '']))
          : {},
      );
    },
  });

  const toggle = (permission: string, on: boolean) =>
    setGranted((prev) => {
      const next = new Set(prev);
      if (on) next.add(permission);
      else next.delete(permission);
      return next;
    });

  const total = catalogue.data?.permissions.length ?? 0;
  const nameError = errors.name;

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        setErrors({});
        if (name.trim() === '') {
          setErrors({ name: t('nameRequired') });
          return;
        }
        save.mutate();
      }}
    >
      {!isNew && role.isOwner ? <Alert tone="info">{t('ownerNote')}</Alert> : null}
      {save.isError && Object.keys(errors).length === 0 ? (
        <Alert>{message(save.error)}</Alert>
      ) : null}
      {errors.permissions ? <Alert>{errors.permissions}</Alert> : null}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field id="role-name" label={t('name')} error={nameError}>
          <Input
            {...describedBy('role-name', { error: nameError })}
            value={name}
            disabled={readOnly}
            onChange={(e) => setName(e.target.value)}
          />
        </Field>
        <Field
          id="role-discount"
          label={t('maxDiscount')}
          hint={t('maxDiscountHint')}
          error={errors.maxDiscountPercent}
        >
          <Input
            {...describedBy('role-discount', { error: errors.maxDiscountPercent, hint: true })}
            type="number"
            min={0}
            max={100}
            step="any"
            value={discount}
            disabled={readOnly}
            onChange={(e) => setDiscount(e.target.value)}
          />
        </Field>
      </div>

      <div className="flex items-center justify-between">
        <h3 className="font-medium">{t('permissions')}</h3>
        <span className="text-xs text-neutral-600">
          {t('selectedCount', { count: granted.size, total })}
        </span>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        {catalogue.data?.resources.map((group) => (
          <PermissionGroup
            key={group.resource}
            label={tp(`resources.${group.resource}`)}
            groupLabel={tp('groupLabel', { resource: tp(`resources.${group.resource}`) })}
            selectAllLabel={tp('selectGroup', { resource: tp(`resources.${group.resource}`) })}
            permissions={group.permissions}
            actionLabel={(permission) => tp(`actions.${permission.split(':')[1]}`)}
            granted={granted}
            disabled={readOnly}
            onToggle={toggle}
            onToggleAll={(on) => group.permissions.forEach((p) => toggle(p, on))}
          />
        ))}
      </div>

      <div className="flex gap-2">
        {readOnly ? null : (
          <Button type="submit" disabled={save.isPending}>
            {save.isPending ? t('save') + '…' : t('save')}
          </Button>
        )}
        <Button type="button" variant="outline" onClick={onClose}>
          {tm('close')}
        </Button>
      </div>
    </form>
  );
}

function PermissionGroup({
  label,
  groupLabel,
  selectAllLabel,
  permissions,
  actionLabel,
  granted,
  disabled,
  onToggle,
  onToggleAll,
}: {
  label: string;
  groupLabel: string;
  selectAllLabel: string;
  permissions: string[];
  actionLabel: (permission: string) => string;
  granted: Set<string>;
  disabled: boolean;
  onToggle: (permission: string, on: boolean) => void;
  onToggleAll: (on: boolean) => void;
}) {
  const count = permissions.filter((p) => granted.has(p)).length;
  const all = count === permissions.length;
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = count > 0 && !all;
  }, [count, all]);

  return (
    <fieldset className="rounded-md border border-neutral-200 p-3" aria-label={groupLabel}>
      <legend className="px-1 text-sm font-medium">{label}</legend>
      <label className="mb-1 flex items-center gap-2 text-xs text-neutral-600">
        <input
          ref={ref}
          type="checkbox"
          disabled={disabled}
          checked={all}
          onChange={(e) => onToggleAll(e.target.checked)}
          aria-label={selectAllLabel}
        />
        {selectAllLabel}
      </label>
      <ul className="flex flex-col gap-1">
        {permissions.map((permission) => (
          <li key={permission}>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                disabled={disabled}
                checked={granted.has(permission)}
                onChange={(e) => onToggle(permission, e.target.checked)}
              />
              {actionLabel(permission)}
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
