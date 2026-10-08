'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '../api-client';

export interface NumberingFormatValue {
  prefix: string;
  includeYear: boolean;
  padding: number;
}

/** The parts of the workspace configuration the settings screens edit (see WorkspaceConfig in the API). */
export interface WorkspaceSettings {
  business: {
    legalName: string;
    phone?: string;
    email?: string;
    address?: string;
    taxNumber?: string;
  };
  branding: { logoFileId?: string; primaryColor?: string };
  locale: {
    currency: string;
    currencyDecimals: number;
    timezone: string;
    language: string;
    dateFormat: string;
  };
  modules: Record<string, boolean>;
  tax: { enabled: boolean; pricesIncludeTax: boolean };
  numbering: Record<string, NumberingFormatValue>;
  documents: {
    receiptPaper: '58mm' | '80mm' | 'A4';
    receiptFooter?: string;
    quotationTerms?: string;
    invoiceTerms?: string;
    showBankDetails: boolean;
    quotationValidityDays: number;
  };
  sales: { requiredDepositPercent: number; discountOverLimit: 'REJECT' | 'APPROVAL' };
}

export interface SettingsSnapshot {
  config: WorkspaceSettings;
  configVersion: number;
}

export const SETTINGS_QUERY_KEY = ['settings'] as const;

export function useSettingsQuery() {
  return useQuery({
    queryKey: SETTINGS_QUERY_KEY,
    queryFn: ({ signal }) => api.get<SettingsSnapshot>('/settings', undefined, signal),
  });
}
