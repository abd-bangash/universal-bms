export interface LocaleSettings {
  currency: string;
  currencyDecimals: number;
  timezone: string;
  language: string;
  dateFormat: 'DD/MM/YYYY' | 'MM/DD/YYYY' | 'YYYY-MM-DD' | 'D MMM YYYY';
}

export const DEFAULT_LOCALE: LocaleSettings = {
  currency: 'USD',
  currencyDecimals: 2,
  timezone: 'UTC',
  language: 'en',
  dateFormat: 'DD/MM/YYYY',
};

const asDecimal = (value: string): number => value as unknown as number; // Intl accepts exact decimal strings

/** Money arrives as a decimal string and is formatted without ever becoming a binary float. */
export function formatMoney(
  value: string | null | undefined,
  locale: LocaleSettings = DEFAULT_LOCALE,
): string {
  if (value === null || value === undefined || value === '') return '';
  return new Intl.NumberFormat(locale.language, {
    style: 'currency',
    currency: locale.currency,
    minimumFractionDigits: locale.currencyDecimals,
    maximumFractionDigits: locale.currencyDecimals,
  }).format(asDecimal(value));
}

/** Quantities and other decimals: grouping and the workspace language, up to `maxDecimals` places. */
export function formatNumber(
  value: string | null | undefined,
  locale: LocaleSettings = DEFAULT_LOCALE,
  maxDecimals = 4,
): string {
  if (value === null || value === undefined || value === '') return '';
  return new Intl.NumberFormat(locale.language, {
    minimumFractionDigits: 0,
    maximumFractionDigits: maxDecimals,
  }).format(asDecimal(value));
}

function parts(
  iso: string,
  timezone: string,
  extra: Intl.DateTimeFormatOptions,
): Map<string, string> {
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hourCycle: 'h23',
    ...extra,
  });
  return new Map(formatter.formatToParts(new Date(iso)).map((p) => [p.type, p.value]));
}

/** A UTC timestamp shown as a date in the workspace timezone and date format. */
export function formatDate(
  iso: string | null | undefined,
  locale: LocaleSettings = DEFAULT_LOCALE,
): string {
  if (!iso) return '';
  const p = parts(iso, locale.timezone, { year: 'numeric', month: '2-digit', day: '2-digit' });
  const [dd, mm, yyyy] = [p.get('day'), p.get('month'), p.get('year')] as [string, string, string];
  switch (locale.dateFormat) {
    case 'DD/MM/YYYY':
      return `${dd}/${mm}/${yyyy}`;
    case 'MM/DD/YYYY':
      return `${mm}/${dd}/${yyyy}`;
    case 'YYYY-MM-DD':
      return `${yyyy}-${mm}-${dd}`;
    case 'D MMM YYYY': {
      const month = new Intl.DateTimeFormat(locale.language, {
        timeZone: locale.timezone,
        month: 'short',
      }).format(new Date(iso));
      return `${Number(dd)} ${month} ${yyyy}`;
    }
  }
}

export function formatDateTime(
  iso: string | null | undefined,
  locale: LocaleSettings = DEFAULT_LOCALE,
): string {
  if (!iso) return '';
  const p = parts(iso, locale.timezone, { hour: '2-digit', minute: '2-digit' });
  return `${formatDate(iso, locale)} ${p.get('hour')}:${p.get('minute')}`;
}
