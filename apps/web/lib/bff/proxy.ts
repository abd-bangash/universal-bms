import { NextResponse, type NextRequest } from 'next/server';
import type { ErrorCode } from '@bms/types';
import {
  ACCESS_COOKIE,
  PUBLIC_API_PATHS,
  REFRESH_COOKIE,
  REFRESH_COOKIE_SECONDS,
  TICKET_COOKIE,
  TICKET_COOKIE_SECONDS,
  WORKSPACES_COOKIE,
  BFF_PREFIX,
} from './constants';
import { isMutating, isSameOrigin, requestOrigin } from './origin';
import { RefreshCoordinator, type TokenPair } from './refresh-coordinator';

export interface BffDeps {
  fetch: typeof fetch;
  /** Internal address of the API, e.g. http://localhost:4000 */
  apiBase: string;
  coordinator: RefreshCoordinator;
}

const SAFE_SEGMENT = /^[A-Za-z0-9._~:@-]+$/;
const FORWARD_REQUEST_HEADERS = [
  'content-type',
  'accept',
  'user-agent',
  'idempotency-key',
  'x-request-id',
  'accept-language',
];
const FORWARD_RESPONSE_HEADERS = [
  'content-type',
  'content-disposition',
  'cache-control',
  'retry-after',
  'x-request-id',
  'etag',
];

function problem(
  status: number,
  code: ErrorCode,
  message: string,
  details?: Record<string, string[]>,
): NextResponse {
  return NextResponse.json(
    { statusCode: status, code, message, ...(details ? { details } : {}), requestId: 'bff' },
    { status },
  );
}

function isHttps(req: NextRequest): boolean {
  return requestOrigin(req.headers, req.nextUrl).startsWith('https://');
}

function setSession(res: NextResponse, req: NextRequest, pair: TokenPair): void {
  const base = { httpOnly: true, sameSite: 'lax' as const, secure: isHttps(req), path: '/' };
  res.cookies.set(ACCESS_COOKIE, pair.accessToken, { ...base, maxAge: pair.expiresIn });
  res.cookies.set(REFRESH_COOKIE, pair.refreshToken, { ...base, maxAge: REFRESH_COOKIE_SECONDS });
}

export function clearSession(res: NextResponse): NextResponse {
  res.cookies.delete(ACCESS_COOKIE);
  res.cookies.delete(REFRESH_COOKIE);
  return res;
}

function setPending(
  res: NextResponse,
  req: NextRequest,
  ticket: string,
  workspaces: unknown,
): void {
  const base = {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: isHttps(req),
    path: BFF_PREFIX,
    maxAge: TICKET_COOKIE_SECONDS,
  };
  res.cookies.set(TICKET_COOKIE, ticket, base);
  res.cookies.set(WORKSPACES_COOKIE, JSON.stringify(workspaces), base);
}

function clearPending(res: NextResponse): void {
  res.cookies.set(TICKET_COOKIE, '', { path: BFF_PREFIX, maxAge: 0 });
  res.cookies.set(WORKSPACES_COOKIE, '', { path: BFF_PREFIX, maxAge: 0 });
}

function isTokenPair(value: unknown): value is TokenPair {
  const v = value as Partial<TokenPair> | null;
  return (
    typeof v?.accessToken === 'string' &&
    typeof v.refreshToken === 'string' &&
    typeof v.expiresIn === 'number'
  );
}

async function callApi(
  deps: BffDeps,
  req: NextRequest,
  path: string,
  body: ArrayBuffer | undefined,
  accessToken: string | undefined,
  overrideBody?: unknown,
): Promise<Response> {
  const headers = new Headers();
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = req.headers.get(name);
    if (value) headers.set(name, value);
  }
  const forwardedFor = req.headers.get('x-forwarded-for');
  if (forwardedFor) headers.set('x-forwarded-for', forwardedFor);
  if (accessToken) headers.set('authorization', `Bearer ${accessToken}`);
  let payload: BodyInit | undefined = body && body.byteLength > 0 ? body : undefined;
  if (overrideBody !== undefined) {
    payload = JSON.stringify(overrideBody);
    headers.set('content-type', 'application/json');
  }
  return deps.fetch(`${deps.apiBase}/api/v1/${path}${req.nextUrl.search}`, {
    method: req.method,
    headers,
    body: ['GET', 'HEAD'].includes(req.method) ? undefined : payload,
    redirect: 'manual',
    cache: 'no-store',
  });
}

async function refreshWith(deps: BffDeps, refreshToken: string): Promise<TokenPair | null> {
  const res = await deps.fetch(`${deps.apiBase}/api/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ refreshToken }),
    cache: 'no-store',
  });
  if (!res.ok) return null;
  const body = (await res.json()) as { data?: unknown };
  return isTokenPair(body.data) ? body.data : null;
}

async function errorCode(res: Response): Promise<string | undefined> {
  try {
    return ((await res.clone().json()) as { code?: string }).code;
  } catch {
    return undefined;
  }
}

function passThrough(res: Response): NextResponse {
  const headers = new Headers();
  for (const name of FORWARD_RESPONSE_HEADERS) {
    const value = res.headers.get(name);
    if (value) headers.set(name, value);
  }
  return new NextResponse(res.status === 204 || res.status === 304 ? null : res.body, {
    status: res.status,
    headers,
  });
}

/**
 * Turns the API's token-bearing answers into cookies, so tokens never reach browser JavaScript.
 * Returns the body the browser is allowed to see.
 */
async function sessionTransform(
  path: string,
  req: NextRequest,
  res: Response,
): Promise<NextResponse | null> {
  const issuesTokens =
    path === 'auth/login' || path === 'auth/select-workspace' || path === 'auth/switch-workspace';
  if (!issuesTokens || !res.ok) return null;
  const body = (await res.json()) as { data?: Record<string, unknown> };
  const data = body.data ?? {};

  if (isTokenPair(data)) {
    const out = NextResponse.json(
      { data: { requiresWorkspaceSelection: false } },
      { status: res.status },
    );
    setSession(out, req, data);
    clearPending(out);
    return out;
  }
  if (data.requiresWorkspaceSelection === true && typeof data.loginTicket === 'string') {
    const out = NextResponse.json(
      { data: { requiresWorkspaceSelection: true, workspaces: data.workspaces } },
      { status: res.status },
    );
    setPending(out, req, data.loginTicket, data.workspaces);
    return out;
  }
  return problem(502, 'EXTERNAL_SERVICE_FAILED', 'Unexpected answer from the server');
}

/** The backend-for-frontend: cookies in, Bearer out, silent refresh, CSRF check. */
export async function handleBff(
  req: NextRequest,
  segments: string[],
  deps: BffDeps,
): Promise<NextResponse> {
  if (
    segments.length === 0 ||
    !segments.every((s) => s !== '.' && s !== '..' && SAFE_SEGMENT.test(s))
  ) {
    return problem(404, 'NOT_FOUND', 'Not found');
  }
  const path = segments.join('/');
  if (path === 'auth/refresh') return problem(404, 'NOT_FOUND', 'Not found'); // refresh is internal to the BFF

  if (isMutating(req.method) && !isSameOrigin(req.headers, req.nextUrl)) {
    return problem(403, 'PERMISSION_DENIED', 'Cross-site request blocked');
  }

  const isPublic = PUBLIC_API_PATHS.has(path);
  let access = req.cookies.get(ACCESS_COOKIE)?.value;
  const refresh = req.cookies.get(REFRESH_COOKIE)?.value;
  let rotated: TokenPair | null = null;
  let overrideBody: unknown;

  if (path === 'auth/select-workspace') {
    // The ticket never reaches the browser: the BFF adds it from its own cookie.
    const ticket = req.cookies.get(TICKET_COOKIE)?.value;
    if (!ticket) return problem(401, 'UNAUTHENTICATED', 'Your sign-in expired; sign in again');
    const sent = (await req.json().catch(() => ({}))) as { workspaceId?: unknown };
    overrideBody = { loginTicket: ticket, workspaceId: sent.workspaceId };
  }

  const body =
    overrideBody === undefined && !['GET', 'HEAD'].includes(req.method)
      ? await req.arrayBuffer()
      : undefined;

  const tryRefresh = async (): Promise<TokenPair | null> => {
    if (!refresh) return null;
    try {
      return await deps.coordinator.refresh(refresh, (token) => refreshWith(deps, token));
    } catch {
      return null;
    }
  };

  try {
    if (!isPublic && !access && refresh) {
      rotated = await tryRefresh();
      access = rotated?.accessToken;
    }
    let res = await callApi(
      deps,
      req,
      path,
      body,
      isPublic && path !== 'tenants' ? undefined : access,
      overrideBody,
    );

    if (!isPublic && res.status === 401 && refresh) {
      const code = await errorCode(res);
      if (code === 'TOKEN_EXPIRED' || code === 'TOKEN_STALE') {
        rotated = await tryRefresh();
        if (!rotated)
          return clearSession(problem(401, 'UNAUTHENTICATED', 'Your session has expired'));
        res = await callApi(deps, req, path, body, rotated.accessToken, overrideBody);
      }
    }
    // Read the final error code before the body is handed to the browser.
    const failedCode = res.status === 401 ? await errorCode(res) : undefined;
    if (!isPublic && res.status === 401 && !rotated && !access) {
      return clearSession(problem(401, 'UNAUTHENTICATED', 'Authentication is required'));
    }

    const transformed = await sessionTransform(path, req, res);
    const out = transformed ?? passThrough(res);
    if (rotated && !transformed) setSession(out, req, rotated);
    if (path === 'auth/logout') clearSession(out);
    if (!isPublic && failedCode === 'UNAUTHENTICATED') clearSession(out);
    return out;
  } catch {
    return problem(502, 'EXTERNAL_SERVICE_FAILED', 'The server is not reachable');
  }
}

export function defaultDeps(coordinator: RefreshCoordinator): BffDeps {
  return {
    fetch: (input, init) => fetch(input, init),
    apiBase: process.env.API_INTERNAL_URL ?? 'http://localhost:4000',
    coordinator,
  };
}
