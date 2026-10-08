'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
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

export function InviteForm({ token }: { token: string }) {
  const t = useTranslations('auth');
  const [done, setDone] = useState(false);
  const schema = useMemo(
    () =>
      z.object({
        firstName: z.string().trim().min(1),
        lastName: z.string().trim().min(1),
        password: z.string().min(1),
      }),
    [],
  );
  type Values = z.infer<typeof schema>;
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { firstName: '', lastName: '', password: '' },
  });
  const { errors } = form.formState;

  if (done) {
    return (
      <Card className="flex flex-col gap-3">
        <Alert tone="success">{t('invite.success')}</Alert>
        <Link href="/login" className="text-sm underline">
          {t('invite.signIn')}
        </Link>
      </Card>
    );
  }

  return (
    <Card>
      <h1 className="text-xl font-semibold">{t('invite.title')}</h1>
      <p className="mb-4 text-sm text-neutral-600">{t('invite.subtitle')}</p>
      <FormShell
        form={form}
        submitLabel={t('invite.submit')}
        onSubmit={async (values) => {
          await api.post('/auth/invite/accept', { token, ...values });
          setDone(true);
        }}
      >
        <Field id="firstName" label={t('firstName')} error={errors.firstName?.message}>
          <Input
            {...describedBy('firstName', { error: errors.firstName?.message })}
            autoComplete="given-name"
            {...form.register('firstName')}
          />
        </Field>
        <Field id="lastName" label={t('lastName')} error={errors.lastName?.message}>
          <Input
            {...describedBy('lastName', { error: errors.lastName?.message })}
            autoComplete="family-name"
            {...form.register('lastName')}
          />
        </Field>
        <Field
          id="password"
          label={t('password')}
          hint={t('passwordHint')}
          error={errors.password?.message}
        >
          <Input
            {...describedBy('password', { error: errors.password?.message, hint: true })}
            type="password"
            autoComplete="new-password"
            {...form.register('password')}
          />
        </Field>
      </FormShell>
    </Card>
  );
}
