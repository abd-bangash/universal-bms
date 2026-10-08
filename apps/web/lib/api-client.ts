import type { ErrorEnvelope, SuccessEnvelope } from '@bms/types';
import { ApiError } from './errors';
import { isPublicPath, loginUrl } from './return-url';

/** The browser talks only to its own server (the BFF), never to the API directly (design D12). */
export const BFF_BASE = '/api/bff';

export type QueryParams = Record<string, string | number | boolean | null | undefined>;

export interface Page<T> {
  items: T[];
  nextCursor?: string;
  total?: number;
}

function buildUrl(path: string, params?: QueryParams): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params ?? {})) {
    if (value !== undefined && value !== null && value !== '') query.set(key, String(value));
  }
  const text = query.toString();
  return `${BFF_BASE}${path.startsWith('/') ? path : `/${path}`}${text ? `?${text}` : ''}`;
}

/** The few browser calls this module makes, behind one object so tests can observe them. */
export const browser = {
  pathname: (): string => window.location.pathname,
  search: (): string => window.location.search,
  assign: (url: string): void => window.location.assign(url),
};

/** Sends the user to the login page, remembering where they were (Requirement 49.10). */
export function redirectToLogin(): void {
  if (typeof window === 'undefined' || isPublicPath(browser.pathname())) return;
  browser.assign(loginUrl(browser.pathname() + browser.search()));
}

async function parseError(response: Response): Promise<ApiError> {
  try {
    const body = (await response.json()) as ErrorEnvelope;
    if (typeof body?.code === 'string') return ApiError.fromEnvelope(body);
  } catch {
    // not JSON: fall through
  }
  return new ApiError(response.status, 'INTERNAL_ERROR', response.statusText || 'Request failed');
}

export interface RequestOptions {
  params?: QueryParams;
  body?: unknown;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

async function send(
  method: string,
  path: string,
  options: RequestOptions,
  body?: BodyInit,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(buildUrl(path, options.params), {
      method,
      headers: options.headers,
      body,
      signal: options.signal,
      credentials: 'same-origin',
      cache: 'no-store',
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError(0, 'NETWORK_ERROR', 'The server could not be reached');
  }
  if (!response.ok) {
    const error = await parseError(response);
    if (error.isSessionExpired) redirectToLogin();
    throw error;
  }
  return response;
}

async function json<T>(
  method: string,
  path: string,
  options: RequestOptions = {},
): Promise<SuccessEnvelope<T>> {
  const hasBody = options.body !== undefined;
  const response = await send(
    method,
    path,
    {
      ...options,
      headers: {
        Accept: 'application/json',
        ...(hasBody ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
    },
    hasBody ? JSON.stringify(options.body) : undefined,
  );
  if (response.status === 204) return { data: undefined as T };
  return (await response.json()) as SuccessEnvelope<T>;
}

export const api = {
  /** GET returning the `data` of the envelope. */
  async get<T>(path: string, params?: QueryParams, signal?: AbortSignal): Promise<T> {
    return (await json<T>('GET', path, { params, signal })).data;
  },
  /** GET of a list endpoint: items plus the cursor and total from `meta`. */
  async getPage<T>(path: string, params?: QueryParams, signal?: AbortSignal): Promise<Page<T>> {
    const envelope = await json<T[]>('GET', path, { params, signal });
    return {
      items: envelope.data,
      nextCursor: envelope.meta?.nextCursor,
      total: envelope.meta?.total,
    };
  },
  async post<T>(path: string, body?: unknown, options: RequestOptions = {}): Promise<T> {
    return (await json<T>('POST', path, { ...options, body: body ?? {} })).data;
  },
  async patch<T>(path: string, body: unknown, options: RequestOptions = {}): Promise<T> {
    return (await json<T>('PATCH', path, { ...options, body })).data;
  },
  async put<T>(path: string, body: unknown, options: RequestOptions = {}): Promise<T> {
    return (await json<T>('PUT', path, { ...options, body })).data;
  },
  async delete(path: string, params?: QueryParams): Promise<void> {
    await json<void>('DELETE', path, { params });
  },
  /** Multipart upload (files). The browser sets the boundary, so no Content-Type is given. */
  async upload<T>(path: string, form: FormData): Promise<T> {
    const response = await send('POST', path, { headers: { Accept: 'application/json' } }, form);
    return ((await response.json()) as SuccessEnvelope<T>).data;
  },
  /** Binary downloads such as PDFs. */
  async blob(path: string, params?: QueryParams): Promise<Blob> {
    return (await send('GET', path, { params })).blob();
  },
};
