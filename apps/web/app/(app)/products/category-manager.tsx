'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import { FormShell } from '@/components/forms/form-shell';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Field, describedBy } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { StatusBadge } from '@/components/ui/status-badge';
import { api } from '@/lib/api-client';
import { useErrorMessage } from '@/lib/error-message';
import { flattenCategories, useCategoriesQuery } from '@/lib/hooks/use-catalog';
import { usePermission } from '@/lib/session';

interface CategoryForm {
  name: string;
  parentId: string;
  sortOrder: string;
  active: boolean;
}

type Flat = ReturnType<typeof flattenCategories>[number];

/** The category tree: add, rename, move and deactivate (categories are never deleted). */
export function CategoryManager() {
  const t = useTranslations('products.categoriesPage');
  const message = useErrorMessage();
  const canEdit = usePermission('product:edit');
  const queryClient = useQueryClient();
  const categories = useCategoriesQuery(true);
  const [editing, setEditing] = useState<Flat | 'new' | null>(null);
  const flat = flattenCategories(categories.data ?? []);

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
      {categories.isError ? <Alert>{message(categories.error)}</Alert> : null}
      {categories.isPending ? <p role="status">{t('loading')}</p> : null}
      {categories.isSuccess && flat.length === 0 ? (
        <p className="text-sm text-neutral-600">{t('empty')}</p>
      ) : null}
      <ul className="divide-y divide-neutral-200 rounded-md border border-neutral-200">
        {flat.map((c) => (
          <li
            key={c.id}
            className="flex items-center justify-between gap-2 px-3 py-2"
            style={{ paddingLeft: `${0.75 + c.depth * 1.5}rem` }}
          >
            <span className={c.active ? '' : 'text-neutral-500'}>
              {c.name}
              {c.active ? null : (
                <StatusBadge className="ml-2" label={t('inactive')} color="#a3a3a3" />
              )}
            </span>
            {canEdit ? (
              <Button type="button" variant="outline" size="sm" onClick={() => setEditing(c)}>
                {t('edit')}
                <span className="sr-only"> {c.name}</span>
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
          <CategoryEditor
            key={editing === 'new' ? 'new' : editing.id}
            category={editing === 'new' ? null : editing}
            all={flat}
            onClose={() => setEditing(null)}
            onDone={async () => {
              setEditing(null);
              await queryClient.invalidateQueries({ queryKey: ['catalog', 'categories'] });
            }}
          />
        ) : null}
      </Modal>
    </div>
  );
}

function CategoryEditor({
  category,
  all,
  onClose,
  onDone,
}: {
  category: Flat | null;
  all: Flat[];
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const t = useTranslations('products.categoriesPage');
  const form = useForm<CategoryForm>({
    defaultValues: {
      name: category?.name ?? '',
      parentId: category?.parentId ?? '',
      sortOrder: String(category?.sortOrder ?? 0),
      active: category?.active ?? true,
    },
  });
  const { errors } = form.formState;

  // A category cannot move under itself or one of its own sub-categories.
  const blocked = new Set<string>();
  if (category) {
    blocked.add(category.id);
    let grew = true;
    while (grew) {
      grew = false;
      for (const c of all) {
        if (c.parentId && blocked.has(c.parentId) && !blocked.has(c.id)) {
          blocked.add(c.id);
          grew = true;
        }
      }
    }
  }

  async function submit(values: CategoryForm) {
    const body = {
      name: values.name.trim(),
      parentId: values.parentId || null,
      sortOrder: Number(values.sortOrder) || 0,
    };
    if (category)
      await api.patch(`/catalog/categories/${category.id}`, { ...body, active: values.active });
    else await api.post('/catalog/categories', body);
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
      <Field id="category-name" label={t('name')} error={errors.name?.message} required>
        <Input
          {...describedBy('category-name', { error: errors.name?.message })}
          {...form.register('name', { required: t('nameRequired') })}
        />
      </Field>
      <Field id="category-parent" label={t('parent')} error={errors.parentId?.message}>
        <Select
          {...describedBy('category-parent', { error: errors.parentId?.message })}
          {...form.register('parentId')}
        >
          <option value="">{t('topLevel')}</option>
          {all
            .filter((c) => !blocked.has(c.id))
            .map((c) => (
              <option key={c.id} value={c.id}>
                {`${'— '.repeat(c.depth)}${c.name}`}
              </option>
            ))}
        </Select>
      </Field>
      <Field id="category-sort" label={t('sortOrder')} error={errors.sortOrder?.message}>
        <Input
          {...describedBy('category-sort', { error: errors.sortOrder?.message })}
          inputMode="numeric"
          {...form.register('sortOrder')}
        />
      </Field>
      {category ? (
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" {...form.register('active')} />
          {t('active')}
        </label>
      ) : null}
    </FormShell>
  );
}
