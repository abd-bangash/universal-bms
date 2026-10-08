import { Injectable } from '@nestjs/common';
import { parsePhoneNumberFromString, type CountryCode } from 'libphonenumber-js';
import { ValidationFailedException } from '../../common/errors/app.exception';
import { SettingsService } from '../settings/settings.service';

/** Pure normalisation to E.164; null when the text is not a possible phone number. */
export function normalizePhone(raw: string, country?: string): string | null {
  const text = raw.trim();
  if (text === '') return null;
  const parsed = parsePhoneNumberFromString(text, country as CountryCode | undefined);
  return parsed?.isPossible() ? parsed.number : null;
}

/**
 * Phone numbers are stored as written and, next to them, in E.164 so that "0300-1234567" and
 * "+92 300 1234567" are recognised as the same person (design.md CRM).
 */
@Injectable()
export class PhoneService {
  constructor(private readonly settings: SettingsService) {}

  async country(): Promise<string | undefined> {
    return (await this.settings.get<string | undefined>('locale.defaultCountry')) ?? undefined;
  }

  /** Normalises one number; throws a field error when it cannot be read. */
  async normalizeOne(raw: string, field = 'phone'): Promise<string> {
    const country = await this.country();
    const normalized = normalizePhone(raw, country);
    if (!normalized) throw new ValidationFailedException({ [field]: [this.message(country)] });
    return normalized;
  }

  /** Normalises a list, dropping blanks and repeats (of the same number in any format). */
  async normalizeMany(
    raw: readonly string[],
    field = 'phones',
  ): Promise<{ phones: string[]; normalized: string[] }> {
    const country = await this.country();
    const phones: string[] = [];
    const normalized: string[] = [];
    const bad: string[] = [];
    for (const item of raw) {
      if (item.trim() === '') continue;
      const e164 = normalizePhone(item, country);
      if (!e164) {
        bad.push(item.trim());
        continue;
      }
      if (normalized.includes(e164)) continue;
      normalized.push(e164);
      phones.push(item.trim());
    }
    if (bad.length > 0) {
      throw new ValidationFailedException({
        [field]: [`${bad.map((b) => `"${b}"`).join(', ')}: ${this.message(country)}`],
      });
    }
    return { phones, normalized };
  }

  private message(country: string | undefined): string {
    return country
      ? 'is not a valid phone number'
      : 'is not a valid phone number; include the country code (for example +92 300 1234567) or set the business country in Settings';
  }
}
