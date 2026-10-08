'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '../api-client';

export interface IntegrationField {
  key: string;
  label: string;
  secret: boolean;
  value: string;
}

export interface IntegrationView {
  id: string;
  provider: string;
  providerLabel: string;
  type: string;
  status: 'CONNECTED' | 'DISCONNECTED' | 'ERROR';
  displayName: string | null;
  externalAccountId: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  fields: IntegrationField[];
}

export interface ProviderView {
  provider: string;
  type: string;
  label: string;
  fields: Array<{ key: string; label: string; secret: boolean; required: boolean }>;
}

export interface TestResult {
  ok: boolean;
  detail?: string;
  code?: string;
}

export function useIntegrations() {
  return useQuery({
    queryKey: ['integrations'],
    queryFn: ({ signal }) =>
      api.get<{ providers: ProviderView[]; connections: IntegrationView[] }>(
        '/integrations',
        undefined,
        signal,
      ),
  });
}
