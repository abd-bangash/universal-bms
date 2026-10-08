import type { ReactElement, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, type RenderResult } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import messages from '@/messages/en.json';
import { SessionProvider, type Me } from '@/lib/session';

export const baseSession: Me = {
  user: { id: 'u1', email: 'ada@example.test', firstName: 'Ada', lastName: 'Lovelace' },
  workspace: { id: 'w1', name: 'Acme Furniture', industryProfile: 'furniture', locale: {} },
  roles: ['Manager'],
  permissions: ['customer:view', 'order:view', 'pos:sell'],
  terminology: {},
  modules: { pos: true, messaging: true },
};

export function newQueryClient(): QueryClient {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
}

/** Renders with the translation layer, a query cache and (optionally) a signed-in session. */
export function renderWithProviders(
  ui: ReactElement,
  options: { session?: Partial<Me> | null } = {},
): RenderResult {
  const client = newQueryClient();
  const session = options.session === null ? null : { ...baseSession, ...options.session };
  const wrap = ({ children }: { children: ReactNode }) => (
    <NextIntlClientProvider locale="en" messages={messages}>
      <QueryClientProvider client={client}>
        {session ? <SessionProvider value={session}>{children}</SessionProvider> : children}
      </QueryClientProvider>
    </NextIntlClientProvider>
  );
  return render(ui, { wrapper: wrap });
}

/** Replaces global fetch with a scripted fake and returns it. */
export function mockFetch(
  handler: (url: string, init?: RequestInit) => Response | Promise<Response>,
): jest.Mock {
  const fn = jest.fn((input: RequestInfo | URL, init?: RequestInit) =>
    Promise.resolve(handler(String(input), init)),
  );
  global.fetch = fn as unknown as typeof fetch;
  return fn;
}

export const jsonResponse = (
  body: unknown,
  status = 200,
  headers: Record<string, string> = {},
): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

type RouteHandler = (request: { url: URL; body: unknown; method: string }) => unknown | Response;

export interface ApiCall {
  method: string;
  path: string;
  query: URLSearchParams;
  body: unknown;
}

/**
 * Fakes the BFF with a table of `"METHOD /path"` handlers. A handler returns the `data` of the
 * success envelope, or a Response for errors/lists with `meta`. Unknown routes answer 404.
 */
export function mockApi(routes: Record<string, RouteHandler>): {
  calls: ApiCall[];
  fetchMock: jest.Mock;
} {
  const calls: ApiCall[] = [];
  const fetchMock = mockFetch((rawUrl, init) => {
    const url = new URL(rawUrl, 'http://localhost');
    const method = (init?.method ?? 'GET').toUpperCase();
    const path = url.pathname.replace(/^\/api\/bff/, '');
    const body = typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : init?.body;
    calls.push({ method, path, query: url.searchParams, body });
    const handler = routes[`${method} ${path}`];
    if (!handler)
      return jsonResponse(
        { statusCode: 404, code: 'NOT_FOUND', message: 'x', requestId: 'r' },
        404,
      );
    const result = handler({ url, body, method });
    if (result instanceof Response) return result;
    return jsonResponse({ data: result });
  });
  return { calls, fetchMock };
}

export const failure = (
  status: number,
  code: string,
  details?: Record<string, string[]>,
): Response =>
  jsonResponse(
    {
      statusCode: status,
      code,
      message: 'server text',
      ...(details ? { details } : {}),
      requestId: 'r',
    },
    status,
  );

export const page = (
  items: unknown[],
  meta: { nextCursor?: string; total?: number } = {},
): Response => jsonResponse({ data: items, meta });
