import { Injectable } from '@nestjs/common';
import type { AuthUser } from '../../common/decorators/current-user.decorator';
import type { ParsedQuery, SearchGroup, SearchProvider } from './search.types';

export const SEARCH_LIMIT_PER_TYPE = 5;
export const MIN_QUERY_LENGTH = 2;

/**
 * Digits for a phone match: separators ignored and leading zeros dropped, so "0300-123 4567" finds
 * "+923001234567" (Requirement 31.4). Only text that is mostly a number counts as a phone search.
 */
export function parseQuery(raw: string): ParsedQuery {
  const text = raw.trim();
  const digits = text.replace(/\D/g, '').replace(/^0+/, '');
  const isNumberLike = digits.length >= 3 && /^[\d\s\-+().]+$/.test(text);
  return {
    raw: text,
    like: `%${text.replace(/[\\%_]/g, '\\$&')}%`,
    phoneDigits: isNumberLike ? digits : null,
  };
}

@Injectable()
export class SearchService {
  private readonly providers: SearchProvider[] = [];

  register(provider: SearchProvider): void {
    this.providers.push(provider);
  }

  /** One query per permitted entity type, in parallel, at most 5 hits each, empty groups left out. */
  async search(user: AuthUser, raw: string): Promise<SearchGroup[]> {
    const query = parseQuery(raw);
    if (query.raw.length < MIN_QUERY_LENGTH) return [];
    const permitted = this.providers.filter((p) => user.permissions.includes(p.permission));
    const groups = await Promise.all(
      permitted.map(async (p) => ({
        type: p.type,
        hits: await p.search(user, query, SEARCH_LIMIT_PER_TYPE),
      })),
    );
    return groups.filter((g) => g.hits.length > 0);
  }

  get types(): string[] {
    return this.providers.map((p) => p.type);
  }
}
