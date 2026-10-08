'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Field } from '@/components/ui/label';
import { Modal } from '@/components/ui/modal';
import { StatusBadge } from '@/components/ui/status-badge';
import { api } from '@/lib/api-client';
import { ApiError } from '@/lib/errors';
import { useErrorMessage } from '@/lib/error-message';
import { formatDateTime } from '@/lib/format';
import {
  useIntegrations,
  type IntegrationView,
  type ProviderView,
  type TestResult,
} from '@/lib/hooks/use-integrations';
import { usePermission, useWorkspaceLocale } from '@/lib/session';

const STATUS_COLOR: Record<IntegrationView['status'], string> = {
  CONNECTED: '#16a34a',
  ERROR: '#dc2626',
  DISCONNECTED: '#6b7280',
};

/** The connections to outside services: status, last success, last error, a test button (Requirements 24.3, 48.6). */
export function IntegrationsManager() {
  const t = useTranslations('integrations');
  const message = useErrorMessage();
  const locale = useWorkspaceLocale();
  const queryClient = useQueryClient();
  const canManage = usePermission('integration:manage');
  const data = useIntegrations();
  const [connecting, setConnecting] = useState<ProviderView | null>(null);
  const [disconnecting, setDisconnecting] = useState<IntegrationView | null>(null);
  const [results, setResults] = useState<Record<string, TestResult>>({});
  const [testing, setTesting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['integrations'] });

  async function test(c: IntegrationView) {
    setError(null);
    setTesting(c.id);
    try {
      const result = await api.post<TestResult>(`/integrations/${c.id}/test`);
      setResults((r) => ({ ...r, [c.id]: result }));
      await refresh();
    } catch (e) {
      setError(message(e));
    } finally {
      setTesting(null);
    }
  }

  async function disconnect(c: IntegrationView) {
    setError(null);
    try {
      await api.post(`/integrations/${c.id}/disconnect`);
      setDisconnecting(null);
      await refresh();
    } catch (e) {
      setError(message(e));
      setDisconnecting(null);
    }
  }

  const providers = data.data?.providers ?? [];
  const connections = data.data?.connections ?? [];
  const connectedProviders = new Set(
    connections.filter((c) => c.status !== 'DISCONNECTED').map((c) => c.provider),
  );

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      {error ? <Alert>{error}</Alert> : null}
      {data.isError ? <Alert>{message(data.error)}</Alert> : null}
      {data.isPending ? <p role="status">{t('loading')}</p> : null}

      <section aria-labelledby="connected-heading" className="flex flex-col gap-3">
        <h2 id="connected-heading" className="font-medium">
          {t('connected')}
        </h2>
        {data.data && connections.length === 0 ? (
          <p className="text-sm text-neutral-600">{t('noneConnected')}</p>
        ) : null}
        <ul className="flex flex-col gap-3">
          {connections.map((c) => (
            <li key={c.id}>
              <Card>
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium">{c.displayName ?? c.providerLabel}</h3>
                    <StatusBadge label={t(`status.${c.status}`)} color={STATUS_COLOR[c.status]} />
                  </div>
                  {canManage && c.status !== 'DISCONNECTED' ? (
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={testing === c.id}
                        aria-label={t('testLabel', { name: c.displayName ?? c.providerLabel })}
                        onClick={() => void test(c)}
                      >
                        {t('test')}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        aria-label={t('disconnectLabel', {
                          name: c.displayName ?? c.providerLabel,
                        })}
                        onClick={() => setDisconnecting(c)}
                      >
                        {t('disconnect')}
                      </Button>
                    </div>
                  ) : null}
                </div>
                <p className="text-sm text-neutral-600">{c.providerLabel}</p>
                <dl className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
                  <div>
                    <dt className="text-neutral-600">{t('lastSuccess')}</dt>
                    <dd>
                      {c.lastSuccessAt ? formatDateTime(c.lastSuccessAt, locale) : t('never')}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-neutral-600">{t('lastError')}</dt>
                    <dd>
                      {c.lastErrorAt
                        ? `${formatDateTime(c.lastErrorAt, locale)} · ${t(`code.${c.lastError ?? 'UNKNOWN'}` as never)}`
                        : t('none')}
                    </dd>
                  </div>
                  {c.fields
                    .filter((f) => f.value)
                    .map((f) => (
                      <div key={f.key}>
                        <dt className="text-neutral-600">{f.label}</dt>
                        <dd className="break-all">{f.value}</dd>
                      </div>
                    ))}
                </dl>
                {results[c.id] ? (
                  <p
                    role="status"
                    className={`mt-2 text-sm ${results[c.id]?.ok ? 'text-green-800' : 'text-red-800'}`}
                  >
                    {results[c.id]?.ok
                      ? t('testOk', { detail: results[c.id]?.detail ?? '' })
                      : t('testFailed', {
                          code: t(`code.${results[c.id]?.code ?? 'UNKNOWN'}` as never),
                        })}
                  </p>
                ) : null}
              </Card>
            </li>
          ))}
        </ul>
      </section>

      {canManage ? (
        <section aria-labelledby="available-heading" className="flex flex-col gap-3">
          <h2 id="available-heading" className="font-medium">
            {t('available')}
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2">
            {providers.map((p) => (
              <li key={p.provider}>
                <Card>
                  <h3 className="font-medium">{p.label}</h3>
                  <Button
                    type="button"
                    size="sm"
                    className="mt-2"
                    onClick={() => setConnecting(p)}
                    aria-label={t(
                      connectedProviders.has(p.provider) ? 'reconnectLabel' : 'connectLabel',
                      {
                        name: p.label,
                      },
                    )}
                  >
                    {connectedProviders.has(p.provider) ? t('reconnect') : t('connect')}
                  </Button>
                </Card>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {connecting ? (
        <ConnectDialog
          provider={connecting}
          onClose={() => setConnecting(null)}
          onConnected={async () => {
            setConnecting(null);
            await refresh();
          }}
        />
      ) : null}
      <ConfirmDialog
        open={disconnecting !== null}
        destructive
        title={t('disconnectTitle', { name: disconnecting?.displayName ?? '' })}
        description={t('disconnectDescription')}
        confirmLabel={t('disconnect')}
        onConfirm={() => disconnecting && void disconnect(disconnecting)}
        onCancel={() => setDisconnecting(null)}
      />
    </div>
  );
}

function ConnectDialog({
  provider,
  onClose,
  onConnected,
}: {
  provider: ProviderView;
  onClose: () => void;
  onConnected: () => void | Promise<void>;
}) {
  const t = useTranslations('integrations.dialog');
  const message = useErrorMessage();
  const [values, setValues] = useState<Record<string, string>>({});
  const [displayName, setDisplayName] = useState('');
  const [errors, setErrors] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    setError(null);
    setErrors({});
    setSaving(true);
    try {
      await api.post('/integrations', {
        provider: provider.provider,
        ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
        values,
      });
      await onConnected();
    } catch (e) {
      if (e instanceof ApiError && e.details) setErrors(e.details);
      setError(message(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open title={t('title', { name: provider.label })} onClose={onClose}>
      <div className="flex flex-col gap-3">
        {error ? <Alert>{error}</Alert> : null}
        <p className="text-sm text-neutral-600">{t('hint')}</p>
        <Field id="int-display" label={t('displayName')}>
          <Input
            id="int-display"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
        </Field>
        {provider.fields.map((f) => (
          <Field
            key={f.key}
            id={`int-${f.key}`}
            label={f.label}
            required={f.required}
            error={errors[f.key]?.[0]}
          >
            <Input
              id={`int-${f.key}`}
              type={f.secret ? 'password' : 'text'}
              autoComplete="off"
              value={values[f.key] ?? ''}
              onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
            />
          </Field>
        ))}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button type="button" disabled={saving} onClick={() => void save()}>
            {t('save')}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
