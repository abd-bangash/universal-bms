import {
  DEFAULT_LOCALE,
  formatDate,
  formatDateTime,
  formatMoney,
  formatNumber,
  type LocaleSettings,
} from './format';

const pk: LocaleSettings = {
  currency: 'PKR',
  currencyDecimals: 2,
  timezone: 'Asia/Karachi',
  language: 'en',
  dateFormat: 'DD/MM/YYYY',
};

describe('formatMoney', () => {
  it('formats exact decimal strings in the workspace currency', () => {
    expect(formatMoney('1234.5', DEFAULT_LOCALE)).toBe('$1,234.50');
    expect(formatMoney('1234.5', pk)).toMatch(/PKR\s?1,234\.50/);
  });

  it('never loses precision to binary floating point', () => {
    expect(formatMoney('12345678901234567.89', DEFAULT_LOCALE)).toBe('$12,345,678,901,234,567.89');
    expect(formatMoney('0.10', DEFAULT_LOCALE)).toBe('$0.10');
    expect(formatMoney('-5', DEFAULT_LOCALE)).toBe('-$5.00');
  });

  it('honours the currency decimals and leaves empty values empty', () => {
    expect(
      formatMoney('1500', { ...DEFAULT_LOCALE, currency: 'JPY', currencyDecimals: 0 }),
    ).toMatch(/1,500$/);
    expect(formatMoney('', DEFAULT_LOCALE)).toBe('');
    expect(formatMoney(null, DEFAULT_LOCALE)).toBe('');
    expect(formatMoney(undefined)).toBe('');
  });
});

describe('formatNumber', () => {
  it('groups digits and trims trailing zeros up to the maximum', () => {
    expect(formatNumber('1234567.5000')).toBe('1,234,567.5');
    expect(formatNumber('2.12345', DEFAULT_LOCALE, 4)).toBe('2.1235');
    expect(formatNumber('3')).toBe('3');
    expect(formatNumber(null)).toBe('');
  });
});

describe('dates in the workspace timezone (Requirement 49.6)', () => {
  const iso = '2026-03-04T21:30:00.000Z'; // 02:30 on 5 March in Karachi (UTC+5)

  it('shifts the calendar day across timezones', () => {
    expect(formatDate(iso, DEFAULT_LOCALE)).toBe('04/03/2026');
    expect(formatDate(iso, pk)).toBe('05/03/2026');
  });

  it('supports every configured date format', () => {
    expect(formatDate(iso, { ...pk, dateFormat: 'MM/DD/YYYY' })).toBe('03/05/2026');
    expect(formatDate(iso, { ...pk, dateFormat: 'YYYY-MM-DD' })).toBe('2026-03-05');
    expect(formatDate(iso, { ...pk, dateFormat: 'D MMM YYYY' })).toBe('5 Mar 2026');
  });

  it('adds a 24-hour time to date-times and handles empty values', () => {
    expect(formatDateTime(iso, pk)).toBe('05/03/2026 02:30');
    expect(formatDateTime('2026-03-04T00:05:00.000Z', DEFAULT_LOCALE)).toBe('04/03/2026 00:05');
    expect(formatDate(null)).toBe('');
    expect(formatDateTime('')).toBe('');
  });
});
