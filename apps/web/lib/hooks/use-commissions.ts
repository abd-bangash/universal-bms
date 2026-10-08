'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '../api-client';

export type CommissionStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'PAID' | 'REVERSED';
export const COMMISSION_STATUSES: CommissionStatus[] = [
  'PENDING',
  'APPROVED',
  'REJECTED',
  'PAID',
  'REVERSED',
];

export interface CommissionView {
  id: string;
  orderId: string;
  orderNumber: string;
  salespersonId: string;
  salespersonName: string;
  ruleName: string | null;
  calculationBase: string;
  sharePercent: string;
  amount: string;
  status: CommissionStatus;
  approvedAt: string | null;
  paidAt: string | null;
  paidMethod: string | null;
  note: string | null;
  createdAt: string;
}

export interface PerformanceView {
  userId: string;
  leadsAssigned: number;
  leadsWon: number;
  conversionRate: string;
  orders: number;
  salesValue: string;
  averageOrderValue: string;
  commissionsPending: string;
  commissionsApproved: string;
  commissionsPaid: string;
}

export const COMMISSION_COLORS: Record<CommissionStatus, string> = {
  PENDING: '#f59e0b',
  APPROVED: '#2563eb',
  REJECTED: '#78350f',
  PAID: '#16a34a',
  REVERSED: '#6b7280',
};

export function useStaffCommission(userId: string, enabled: boolean) {
  return useQuery({
    queryKey: ['staff-commission', userId],
    enabled,
    queryFn: ({ signal }) =>
      api.get<{ percent: string | null; ruleId: string | null }>(
        `/staff/${userId}/commission`,
        undefined,
        signal,
      ),
  });
}

export function usePerformance(userId: string, from: string, to: string) {
  return useQuery({
    queryKey: ['performance', userId, from, to],
    enabled: !!userId,
    queryFn: ({ signal }) =>
      api.get<PerformanceView>(
        `/staff/${userId}/performance`,
        { from: from || undefined, to: to || undefined },
        signal,
      ),
  });
}
