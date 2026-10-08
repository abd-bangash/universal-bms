import type { Terminology } from '@bms/types';
import type { SettingsService } from '../settings/settings.service';
import type { DocumentSnapshot } from './document.types';

/** The workspace settings a document snapshot freezes (business block, branding, locale, wording). */
export interface SnapshotSettings {
  business: DocumentSnapshot['business'];
  branding: { logoFileId?: string };
  locale: {
    currency: string;
    currencyDecimals: number;
    language: string;
    dateFormat: string;
    timezone: string;
  };
  pricesIncludeTax: boolean;
  terminology: Partial<Terminology>;
  quotationTerms?: string;
  invoiceTerms?: string;
  showBankDetails: boolean;
}

export async function loadSnapshotSettings(settings: SettingsService): Promise<SnapshotSettings> {
  const [business, branding, locale, tax, documents, terminology] = await Promise.all([
    settings.get<DocumentSnapshot['business']>('business'),
    settings.get<{ logoFileId?: string }>('branding'),
    settings.get<SnapshotSettings['locale']>('locale'),
    settings.get<{ pricesIncludeTax: boolean }>('tax'),
    settings.get<{
      quotationTerms?: string;
      invoiceTerms?: string;
      showBankDetails: boolean;
    }>('documents'),
    settings.get<Partial<Terminology> | undefined>('terminology'),
  ]);
  return {
    business,
    branding,
    locale: {
      currency: locale.currency,
      currencyDecimals: locale.currencyDecimals,
      language: locale.language,
      dateFormat: locale.dateFormat,
      timezone: locale.timezone,
    },
    pricesIncludeTax: tax.pricesIncludeTax,
    terminology: terminology ?? {},
    quotationTerms: documents.quotationTerms,
    invoiceTerms: documents.invoiceTerms,
    showBankDetails: documents.showBankDetails,
  };
}
