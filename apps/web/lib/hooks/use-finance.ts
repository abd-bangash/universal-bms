'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '../api-client';

export type PaymentType = 'ORDER_PAYMENT' | 'DEPOSIT' | 'ADVANCE' | 'CREDIT_APPLIED' | 'REFUND';
export type PaymentStatus = 'PENDING_VERIFICATION' | 'CONFIRMED' | 'REJECTED' | 'VOIDED';

export interface PaymentView {
  id: string;
  paymentNumber: string;
  type: PaymentType;
  status: PaymentStatus;
  orderId: string | null;
  customerId: string | null;
  paymentMethodId: string | null;
  amount: string;
  paidAt: string;
  referenceNumber: string | null;
  note: string | null;
  rejectedReason: string | null;
  voidReason: string | null;
}

export interface AccountView {
  id: string;
  type: 'CASH' | 'BANK' | 'MOBILE_WALLET' | 'CARD_TERMINAL';
  name: string;
  showToCustomers: boolean;
  active: boolean;
  bankName?: string | null;
  accountTitle?: string | null;
  accountNumber?: string | null;
  branch?: string | null;
}

export interface MethodView {
  id: string;
  name: string;
  type: 'CASH' | 'CARD' | 'BANK_TRANSFER' | 'MOBILE_MONEY' | 'OTHER';
  accountId: string;
  requiresReference: boolean;
  active: boolean;
}

export interface ExpenseCategoryView {
  id: string;
  name: string;
  active: boolean;
}

export interface ExpenseView {
  id: string;
  categoryId: string;
  amount: string;
  expenseDate: string;
  paymentMethodId: string;
  description: string | null;
  status: 'POSTED' | 'VOIDED';
  voidReason: string | null;
}

export interface ReceivablesView {
  customers: Array<{
    customerId: string;
    customerName: string;
    orders: number;
    invoiced: string;
    paid: string;
    outstanding: string;
    ageing: { current: string; days31to60: string; days61to90: string; over90: string };
  }>;
  totals: { invoiced: string; paid: string; outstanding: string };
}

export function usePaymentMethods(includeInactive = false) {
  return useQuery({
    queryKey: ['finance', 'methods', includeInactive],
    queryFn: ({ signal }) =>
      api.get<MethodView[]>('/settings/payment-methods', { includeInactive }, signal),
  });
}

export function useAccounts(includeInactive = false, enabled = true) {
  return useQuery({
    queryKey: ['finance', 'accounts', includeInactive],
    enabled,
    queryFn: ({ signal }) =>
      api.get<AccountView[]>('/settings/financial-accounts', { includeInactive }, signal),
  });
}

export function useExpenseCategories(includeInactive = false) {
  return useQuery({
    queryKey: ['finance', 'expense-categories', includeInactive],
    queryFn: ({ signal }) =>
      api.get<ExpenseCategoryView[]>('/settings/expense-categories', { includeInactive }, signal),
  });
}

export const newIdempotencyKey = (): string =>
  globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
