'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import { z } from 'zod';
import { FormShell } from '@/components/forms/form-shell';
import { Alert } from '@/components/ui/alert';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Field, describedBy } from '@/components/ui/label';
import { api } from '@/lib/api-client';

export function ResetForm() {
  const t = useTranslations('auth');
  const token = useSearchParams().get('token');
  const [done, setDone] = useState(false);
  const schema = useMemo(() => z.object({ newPassword: z.string().min(1) }), []);
  type Values = z.infer<typeof schema>;
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { newPassword: '' },
  });
  const { errors } = form.formState;

  if (!token) {
    return (
      <Card>
        <Alert tone="info">{t('reset.noToken')}</Alert>
      </Card>
    );
  }
  if (done) {
    return (
      <Card className="flex flex-col gap-3">
        <Alert tone="success">{t('reset.success')}</Alert>
        <Link href="/login" className="text-sm underline">
          {t('reset.signIn')}
        </Link>
      </Card>
    );
  }

  return (
    <Card>
      <h1 className="text-xl font-semibold">{t('reset.title')}</h1>
      <p className="mb-4 text-sm text-neutral-600">{t('reset.subtitle')}</p>
      <FormShell
        form={form}
        submitLabel={t('reset.submit')}
        onSubmit={async (values) => {
          await api.post('/auth/password/reset', { token, newPassword: values.newPassword });
          setDone(true);
        }}
      >
        <Field
          id="newPassword"
          label={t('newPassword')}
          hint={t('passwordHint')}
          error={errors.newPassword?.message}
        >
          <Input
            {...describedBy('newPassword', { error: errors.newPassword?.message, hint: true })}
            type="password"
            autoComplete="new-password"
            {...form.register('newPassword')}
          />
        </Field>
      </FormShell>
    </Card>
  );
}
