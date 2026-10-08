'use client';

import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { api, type Page } from '../api-client';

export type ConversationStatus = 'OPEN' | 'PENDING' | 'CLOSED';
export type DeliveryStatus = 'QUEUED' | 'SENT' | 'DELIVERED' | 'READ' | 'FAILED' | 'RECEIVED';

export interface ConversationView {
  id: string;
  channelType: string;
  status: ConversationStatus;
  contactName: string | null;
  contactPhone: string | null;
  externalContactId: string;
  customerId: string | null;
  customerName: string | null;
  leadId: string | null;
  leadName: string | null;
  assignedToId: string | null;
  assignedToName: string | null;
  unreadCount: number;
  automationActive: boolean;
  automationEffective: boolean;
  aiEnabled: boolean;
  needsHuman: boolean;
  needsHumanReason: string | null;
  lastMessageAt: string | null;
  lastInboundAt: string | null;
  lastMessagePreview: string | null;
  lastMessageDirection: 'INBOUND' | 'OUTBOUND' | null;
  canSendFreeform: boolean;
  optedOut: boolean;
}

export interface MessageView {
  id: string;
  direction: 'INBOUND' | 'OUTBOUND';
  senderType: string;
  senderUserId: string | null;
  senderName: string | null;
  type: string;
  body: string | null;
  attachments: Array<{ fileId: string; name: string; mime: string }>;
  templateId: string | null;
  status: DeliveryStatus;
  failureReason: string | null;
  providerTimestamp: string;
  channelMeta: { location?: { latitude: number; longitude: number; name?: string } } | null;
}

export interface TemplateView {
  id: string;
  name: string;
  kind: 'QUICK_REPLY' | 'MESSAGE' | 'PROVIDER' | 'NOTIFICATION' | 'BANK_DETAILS';
  body: string;
  variables: string[];
  providerName: string | null;
  language: string | null;
  providerStatus: 'APPROVED' | 'PENDING' | 'REJECTED' | null;
  active: boolean;
}

export interface InboxFilters {
  status?: ConversationStatus | '';
  assigned?: 'me' | 'none' | '';
  unread?: boolean;
  needsHuman?: boolean;
  q?: string;
  customerId?: string;
  leadId?: string;
}

const LIVE_MS = 15_000;

/** The inbox list, newest activity first, a page at a time. Refreshes itself so new messages show up. */
export function useConversations(filters: InboxFilters) {
  return useInfiniteQuery({
    queryKey: ['conversations', 'list', filters],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }): Promise<Page<ConversationView>> =>
      api.getPage<ConversationView>(
        '/conversations',
        {
          limit: 30,
          cursor: pageParam,
          status: filters.status || undefined,
          assigned: filters.assigned || undefined,
          unread: filters.unread ? true : undefined,
          needsHuman: filters.needsHuman ? true : undefined,
          q: filters.q?.trim() || undefined,
          customerId: filters.customerId,
          leadId: filters.leadId,
        },
        signal,
      ),
    getNextPageParam: (last) => last.nextCursor,
    refetchInterval: LIVE_MS,
  });
}

export function useConversation(id: string | null) {
  return useQuery({
    queryKey: ['conversations', 'one', id],
    enabled: Boolean(id),
    queryFn: ({ signal }) => api.get<ConversationView>(`/conversations/${id}`, undefined, signal),
    refetchInterval: LIVE_MS,
  });
}

/** Messages of one conversation; the API sends newest first, the thread shows oldest first. */
export function useMessages(id: string | null) {
  return useInfiniteQuery({
    queryKey: ['conversations', 'messages', id],
    enabled: Boolean(id),
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam, signal }) =>
      api.getPage<MessageView>(
        `/conversations/${id}/messages`,
        { limit: 40, cursor: pageParam },
        signal,
      ),
    getNextPageParam: (last) => last.nextCursor,
    refetchInterval: LIVE_MS,
  });
}

export function useTemplates(enabled = true) {
  return useQuery({
    queryKey: ['templates'],
    enabled,
    queryFn: ({ signal }) => api.get<TemplateView[]>('/templates', { active: true }, signal),
    staleTime: 60_000,
  });
}

export function useUnreadConversations() {
  return useQuery({
    queryKey: ['conversations', 'unread-count'],
    queryFn: ({ signal }) =>
      api.get<{ conversations: number }>('/conversations/unread-count', undefined, signal),
    refetchInterval: 60_000,
    select: (r) => r.conversations,
  });
}

/** What to call a conversation: the person it is linked to, else the name the channel gave, else the number. */
export function conversationTitle(c: ConversationView): string {
  return c.customerName ?? c.leadName ?? c.contactName ?? c.contactPhone ?? c.externalContactId;
}
