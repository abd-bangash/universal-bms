import type { AuthUser } from '../../common/decorators/current-user.decorator';

export interface SearchHit {
  id: string;
  type: string;
  title: string;
  subtitle: string | null;
  /** Where the record lives in the web app. */
  href: string;
}

/** One searchable kind of record. Modules register a provider; the service runs them in parallel. */
export interface SearchProvider {
  /** Machine name of the group, e.g. CUSTOMER. */
  type: string;
  /** The `view` permission the user must hold for this group to be searched (Requirement 31.3). */
  permission: string;
  search(user: AuthUser, query: ParsedQuery, limit: number): Promise<SearchHit[]>;
}

/** The text split into what each kind of match needs. */
export interface ParsedQuery {
  raw: string;
  /** Escaped for use in `ILIKE '%…%'`. */
  like: string;
  /** Digits for matching phone numbers regardless of spaces, dashes and country code, or null if the text is not number-like. */
  phoneDigits: string | null;
}

export interface SearchGroup {
  type: string;
  hits: SearchHit[];
}
