const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export interface CurrencyFormat {
  code: string;
  decimals: number;
}

/** Money in the workspace's currency and language, from an exact decimal string. */
export function formatMoney(
  amount: string | number,
  currency: CurrencyFormat,
  language = 'en',
): string {
  const text = typeof amount === 'number' ? String(amount) : amount;
  try {
    return new Intl.NumberFormat(language, {
      style: 'currency',
      currency: currency.code,
      minimumFractionDigits: currency.decimals,
      maximumFractionDigits: currency.decimals,
    }).format(text as unknown as number);
  } catch {
    return `${currency.code} ${Number(text).toFixed(currency.decimals)}`;
  }
}

/** Quantities without trailing zeros: 2, 1.5. */
export function formatQuantity(quantity: string, language = 'en'): string {
  return new Intl.NumberFormat(language, { maximumFractionDigits: 4 }).format(
    quantity as unknown as number,
  );
}

export function formatPercent(rate: string, language = 'en'): string {
  return `${new Intl.NumberFormat(language, { maximumFractionDigits: 4 }).format(rate as unknown as number)}%`;
}

/** A date in the workspace's format and timezone. */
export function formatDate(iso: string, dateFormat = 'DD/MM/YYYY', timeZone = 'UTC'): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(iso));
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  const [yyyy, mm, dd] = [get('year'), get('month'), get('day')];
  switch (dateFormat) {
    case 'MM/DD/YYYY':
      return `${mm}/${dd}/${yyyy}`;
    case 'YYYY-MM-DD':
      return `${yyyy}-${mm}-${dd}`;
    case 'D MMM YYYY':
      return `${Number(dd)} ${MONTHS[Number(mm) - 1]} ${yyyy}`;
    default:
      return `${dd}/${mm}/${yyyy}`;
  }
}

/** A postal address stored as JSON, on lines. */
export function formatAddress(address: unknown): string[] {
  if (!address) return [];
  if (typeof address === 'string') return address.split('\n').filter(Boolean);
  if (typeof address !== 'object') return [];
  const a = address as Record<string, unknown>;
  const text = (key: string) => (typeof a[key] === 'string' ? (a[key] as string).trim() : '');
  const cityLine = [text('city'), text('state'), text('postalCode')].filter(Boolean).join(', ');
  return [text('line1'), text('line2'), cityLine, text('country')].filter(Boolean);
}
