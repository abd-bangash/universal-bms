'use client';

import { useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { zodResolver } from '@hookform/resolvers/zod';
import { useForm } from 'react-hook-form';
import { useTranslations } from 'next-intl';
import { z } from 'zod';
import { FormShell } from '@/components/forms/form-shell';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Field, describedBy } from '@/components/ui/label';
import { api } from '@/lib/api-client';
import { sanitizeReturnUrl } from '@/lib/return-url';

export function LoginForm() {
  const t = useTranslations('auth');
  const router = useRouter();
  const returnTo = sanitizeReturnUrl(useSearchParams().get('returnTo'));

  const schema = useMemo(
    () =>
      z.object({
        email: z.string().email(t('login.emailInvalid')),
        password: z.string().min(1, t('login.passwordRequired')),
      }),
    [t],
  );
  type Values = z.infer<typeof schema>;
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: { email: '', password: '' },
  });
  const { errors } = form.formState;

  async function submit(values: Values) {
    const result = await api.post<{ requiresWorkspaceSelection: boolean }>('/auth/login', values);
    router.replace(
      result.requiresWorkspaceSelection
        ? `/select-workspace?returnTo=${encodeURIComponent(returnTo)}`
        : returnTo,
    );
  }

  return (
    <Card>
      <h1 className="text-xl font-semibold">{t('login.title')}</h1>
      <p className="mb-4 text-sm text-neutral-600">{t('login.subtitle')}</p>
      <FormShell form={form} onSubmit={submit} submitLabel={t('login.submit')}>
        <Field id="email" label={t('email')} error={errors.email?.message}>
          <Input
            {...describedBy('email', { error: errors.email?.message })}
            type="email"
            autoComplete="username"
            {...form.register('email')}
          />
        </Field>
        <Field id="password" label={t('password')} error={errors.password?.message}>
          <Input
            {...describedBy('password', { error: errors.password?.message })}
            type="password"
            autoComplete="current-password"
            {...form.register('password')}
          />
        </Field>
      </FormShell>
      <p className="mt-4 text-xs text-neutral-600">{t('login.forgot')}</p>
    </Card>
  );
}
