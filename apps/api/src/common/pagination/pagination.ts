import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { ValidationFailedException } from '../errors/app.exception';

export const DEFAULT_PAGE_LIMIT = 25;
export const MAX_PAGE_LIMIT = 100;

/** Query parameters shared by every list endpoint. */
export class PageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_LIMIT)
  limit: number = DEFAULT_PAGE_LIMIT;

  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @IsString()
  sort?: string;

  @IsOptional()
  @IsString()
  q?: string;
}

/** A page of results; the envelope interceptor turns it into { data, meta }. */
export class Page<T> {
  constructor(
    readonly items: T[],
    readonly nextCursor?: string,
    readonly total?: number,
  ) {}

  /** Maps rows (for example to response DTOs) and keeps the cursor and total. */
  map<U>(fn: (item: T) => U): Page<U> {
    return new Page(this.items.map(fn), this.nextCursor, this.total);
  }
}

export type CursorPayload = Record<string, string | number | null>;

/** Cursors are opaque to clients: base64url of a small JSON object. */
export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

export function decodeCursor(cursor: string): CursorPayload {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as CursorPayload;
    }
  } catch {
    // falls through to the validation error below
  }
  throw new ValidationFailedException({ cursor: ['is not a valid cursor'] });
}

export interface SortSpec {
  field: string;
  direction: 'asc' | 'desc';
}

/** Parses `?sort=field:asc|desc` against an allow-list so only indexed fields can be sorted. */
export function parseSort(
  sort: string | undefined,
  allowed: readonly string[],
  fallback: SortSpec,
): SortSpec {
  if (!sort) return fallback;
  const [field, direction = 'asc'] = sort.split(':');
  if (!field || !allowed.includes(field) || (direction !== 'asc' && direction !== 'desc')) {
    throw new ValidationFailedException({
      sort: [`must be one of ${allowed.join(', ')} followed by :asc or :desc`],
    });
  }
  return { field, direction };
}

/**
 * Builds a page from rows fetched with `limit + 1`. The extra row, when present,
 * proves another page exists and is dropped from the result.
 */
export function toPage<T>(
  rows: T[],
  limit: number,
  cursorOf: (last: T) => CursorPayload,
  total?: number,
): Page<T> {
  if (rows.length <= limit) return new Page(rows, undefined, total);
  const items = rows.slice(0, limit);
  return new Page(items, encodeCursor(cursorOf(items[items.length - 1] as T)), total);
}
