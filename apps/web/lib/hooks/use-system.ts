'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '../api-client';

export interface SystemStatus {
  checkedAt: string;
  services: Array<{ name: string; up: boolean }>;
  integrations: Array<{
    provider: string;
    type: string;
    status: string;
    lastSuccessAt: string | null;
    lastErrorAt: string | null;
    lastError: string | null;
  }>;
  queues: Array<{ name: string; waiting: number; active: number; delayed: number; failed: number }>;
  deadLetters: number;
  lastBackup: { at: string; note: string | null } | null;
}

export function useSystemStatus() {
  return useQuery({
    queryKey: ['system-status'],
    queryFn: ({ signal }) => api.get<SystemStatus>('/system/status', undefined, signal),
    refetchInterval: 30_000,
  });
}
