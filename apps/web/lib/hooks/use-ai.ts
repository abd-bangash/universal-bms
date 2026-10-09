'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api } from '../api-client';

export type DisabledReason =
  | 'MODE_OFF'
  | 'MODULE_DISABLED'
  | 'CONVERSATION_OFF'
  | 'DAILY_LIMIT'
  | 'TOKEN_BUDGET'
  | 'NOT_CONFIGURED';

export interface AiSettingsView {
  provider?: string;
  model?: string;
  tone: 'FORMAL' | 'FRIENDLY';
  replyLanguage: string;
  maxReplyChars: number;
  confidenceThreshold: number;
  escalationKeywords: string[];
  contextMessageCount: number;
}

export interface AiStatus {
  mode: 'OFF' | 'ASSIST' | 'AUTO_REPLY';
  moduleEnabled: boolean;
  providerConfigured: boolean;
  provider: string | null;
  providers: string[];
  settings: AiSettingsView;
  usage: {
    requestsToday: number;
    dailyLimit: number;
    tokensThisMonth: number;
    monthlyBudget: number;
  };
}

export interface SuggestionView {
  id: string;
  conversationId: string | null;
  leadId: string | null;
  type: 'SUMMARY' | 'EXTRACTION' | 'DRAFT_REPLY' | 'CLASSIFICATION' | 'NEXT_ACTION' | 'NOTE';
  status: 'PENDING' | 'APPROVED' | 'EDITED' | 'REJECTED' | 'SUPERSEDED' | 'AUTO_SENT';
  payload: Record<string, unknown> & { reasons?: string[] };
  flags: string[];
  confidence: number | null;
  createdAt: string;
  decidedAt: string | null;
  decidedById: string | null;
}

export type RunResult =
  | { status: 'OK'; suggestion: SuggestionView }
  | { status: 'DISABLED'; reason: DisabledReason }
  | { status: 'FAILED'; code: string };

export interface ExtractedField {
  key: string;
  label: string;
  value: string;
  confidence: number;
  level: 'HIGH' | 'MEDIUM' | 'LOW';
  grounded: boolean;
}

export interface KnowledgeItemView {
  id: string;
  title: string;
  body: string;
  active: boolean;
  updatedAt: string;
}

export interface AiLogRow {
  id: string;
  conversationId: string | null;
  actionType: string;
  providerName: string;
  modelVersion: string | null;
  promptVersion: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number | null;
  confidenceScore: number | null;
  outcome: 'SUCCESS' | 'FAILED' | 'TIMEOUT' | 'DISABLED' | 'LIMIT_REACHED';
  error: string | null;
  humanApproved: boolean;
  approvedAt: string | null;
  createdAt: string;
}

export const AI_STATUS_KEY = ['ai', 'status'] as const;

export function useAiStatus(enabled = true) {
  return useQuery({
    queryKey: AI_STATUS_KEY,
    enabled,
    queryFn: ({ signal }) => api.get<AiStatus>('/ai/status', undefined, signal),
  });
}

export function useSuggestions(conversationId: string, enabled = true) {
  return useQuery({
    queryKey: ['ai', 'suggestions', conversationId],
    enabled,
    queryFn: ({ signal }) =>
      api.get<SuggestionView[]>(
        `/ai/conversations/${conversationId}/suggestions`,
        undefined,
        signal,
      ),
    refetchInterval: 20_000,
  });
}

export function useKnowledge() {
  return useQuery({
    queryKey: ['ai', 'knowledge'],
    queryFn: ({ signal }) => api.get<KnowledgeItemView[]>('/ai/knowledge', undefined, signal),
  });
}

export function useAiLogs() {
  return useInfiniteQuery({
    queryKey: ['ai', 'logs'],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      api.getPage<AiLogRow>('/ai/logs', { limit: 30, cursor: pageParam }, signal),
    getNextPageParam: (last) => last.nextCursor,
  });
}
