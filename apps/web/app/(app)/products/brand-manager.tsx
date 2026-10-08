'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import { FormShell } from '@/components/forms/form-shell';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Field, describedBy } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { StatusBadge } from '@/components/ui/status-badge';
import { api } from '@/lib/api-client';
import { useErrorMessage } from '@/lib/error-message';
import { useBrandsQuery, type Brand } from '@/lib/hooks/use-catalog';
import { usePermission } from '@/lib/session';

interface BrandForm {
  name: string;
  active: boolean;
}

/** Brands: add, rename and deactivate. */
export function BrandManager() {
  const t = useTranslations('products.brandsPage');
  const message = useErrorMessage();
  const canEdit = usePermission('product:edit');
  const queryClient = useQueryClient();
  const brands = useBrandsQuery(true);
  const [editing, setEditing] = useState<Brand | 'new' | null>(null);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-2xl font-semibold">{t('title')}</h1>
        {canEdit ? (
          <Button type="button" onClick={() => setEditing('new')}>
            {t('add')}
          </Button>
        ) : null}
      </div>
      {brands.isError ? <Alert>{message(brands.error)}</Alert> : null}
      {brands.isPending ? <p role="status">{t('loading')}</p> : null}
      {brands.isSuccess && brands.data.length === 0 ? (
        <p className="text-sm text-neutral-600">{t('empty')}</p>
      ) : null}
      <ul className="divide-y divide-neutral-200 rounded-md border border-neutral-200">
        {(brands.data ?? []).map((b) => (
          <li key={b.id} className="flex items-center justify-between gap-2 px-3 py-2">
            <span className={b.active ? '' : 'text-neutral-500'}>
              {b.name}
              {b.active ? null : (
                <StatusBadge className="ml-2" label={t('inactive')} color="#a3a3a3" />
              )}
            </span>
            {canEdit ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setEditing(b)}>
                {t('edit')}
                <span className="sr-only"> {b.name}</span>
              </Button>
            ) : null}
          </li>
        ))}
      </ul>
      <Modal
        open={editing !== null}
        title={editing === 'new' ? t('addTitle') : t('editTitle', { name: editing?.name ?? '' })}
        onClose={() => setEditing(null)}
      >
        {editing ? (
          <BrandEditor
            key={editing === 'new' ? 'new' : editing.id}
            brand={editing === 'new' ? null : editing}
            onClose={() => setEditing(null)}
            onDone={async () => {
              setEditing(null);
              await queryClient.invalidateQueries({ queryKey: ['catalog', 'brands'] });
            }}
          />
        ) : null}
      </Modal>
    </div>
  );
}

function BrandEditor({
  brand,
  onClose,
  onDone,
}: {
  brand: Brand | null;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const t = useTranslations('products.brandsPage');
  const form = useForm<BrandForm>({
    defaultValues: { name: brand?.name ?? '', active: brand?.active ?? true },
  });
  const { errors } = form.formState;

  async function submit(values: BrandForm) {
    if (brand)
      await api.patch(`/catalog/brands/${brand.id}`, {
        name: values.name.trim(),
        active: values.active,
      });
    else await api.post('/catalog/brands', { name: values.name.trim() });
    await onDone();
  }

  return (
    <FormShell
      form={form}
      onSubmit={submit}
      submitLabel={t('save')}
      actions={
        <Button type="button" variant="outline" onClick={onClose}>
          {t('cancel')}
        </Button>
      }
    >
      <Field id="brand-name" label={t('name')} error={errors.name?.message} required>
        <Input
          {...describedBy('brand-name', { error: errors.name?.message })}
          {...form.register('name', { required: t('nameRequired') })}
        />
      </Field>
      {brand ? (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" {...form.register('active')} />
          {t('active')}
        </label>
      ) : null}
    </FormShell>
  );
}
