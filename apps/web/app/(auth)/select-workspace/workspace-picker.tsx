'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { api } from '@/lib/api-client';
import { useErrorMessage } from '@/lib/error-message';
import { sanitizeReturnUrl } from '@/lib/return-url';

export function WorkspacePicker() {
  const t = useTranslations('auth.selectWorkspace');
  const message = useErrorMessage();
  const router = useRouter();
  const returnTo = sanitizeReturnUrl(useSearchParams().get('returnTo'));
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const workspaces = useQuery({
    queryKey: ['pending-workspaces'],
    queryFn: () => api.get<Array<{ id: string; name: string }>>('/session/pending'),
    retry: false,
  });

  async function choose(workspaceId: string) {
    setPending(workspaceId);
    setError(null);
    try {
      await api.post('/auth/select-workspace', { workspaceId });
      router.replace(returnTo);
    } catch (e) {
      setError(message(e));
      setPending(null);
    }
  }

  return (
    <Card>
      <h1 className="text-xl font-semibold">{t('title')}</h1>
      <p className="mb-4 text-sm text-neutral-600">{t('subtitle')}</p>
      {workspaces.isError ? (
        <div className="flex flex-col gap-3">
          <Alert>{t('expired')}</Alert>
          <Link href="/login" className="text-sm underline">
            {t('backToLogin')}
          </Link>
        </div>
      ) : workspaces.isPending ? null : workspaces.data.length === 0 ? (
        <Alert tone="info">{t('none')}</Alert>
      ) : (
        <ul className="flex flex-col gap-2">
          {workspaces.data.map((w) => (
            <li key={w.id}>
              <Button
                type="button"
                variant="outline"
                className="w-full justify-start"
                disabled={pending !== null}
                onClick={() => void choose(w.id)}
              >
                {w.name}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {error ? <Alert className="mt-3">{error}</Alert> : null}
    </Card>
  );
}
