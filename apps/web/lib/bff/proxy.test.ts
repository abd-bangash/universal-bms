/** @jest-environment node */
import { NextRequest } from 'next/server';
import { handleBff, type BffDeps } from './proxy';
import { RefreshCoordinator } from './refresh-coordinator';

const ORIGIN = 'http://localhost:3000';
const PAIR = { accessToken: 'new-access', refreshToken: 'new-refresh', expiresIn: 900 };

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
const apiError = (status: number, code: string) =>
  json({ statusCode: status, code, message: 'x', requestId: 'r' }, status);

interface Call {
  url: string;
  method: string;
  headers: Headers;
  body: string | null;
}

function setup(handler: (call: Call) => Response | Promise<Response>) {
  const calls: Call[] = [];
  const deps: BffDeps = {
    apiBase: 'http://api.internal:4000',
    coordinator: new RefreshCoordinator(),
    fetch: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const call: Call = {
        url: String(input),
        method: init?.method ?? 'GET',
        headers: new Headers(init?.headers),
        body: init?.body ? Buffer.from(init.body as string).toString('utf8') : null,
      };
      calls.push(call);
      return handler(call);
    }) as typeof fetch,
  };
  return { deps, calls };
}

function request(
  path: string,
  init: {
    method?: string;
    cookies?: Record<string, string>;
    headers?: Record<string, string>;
    body?: BodyInit;
    origin?: string | null;
  } = {},
) {
  const method = init.method ?? 'GET';
  const headers = new Headers(init.headers);
  if (init.cookies)
    headers.set(
      'cookie',
      Object.entries(init.cookies)
        .map(([k, v]) => `${k}=${v}`)
        .join('; '),
    );
  if (init.origin !== null && method !== 'GET') headers.set('origin', init.origin ?? ORIGIN);
  return new NextRequest(`${ORIGIN}/api/bff/${path}`, { method, headers, body: init.body });
}

const run = (req: NextRequest, deps: BffDeps) =>
  handleBff(req, new URL(req.url).pathname.replace('/api/bff/', '').split('/'), deps);
const cookie = (res: Response, name: string) =>
  res.headers.getSetCookie().find((c) => c.startsWith(`${name}=`));
const apiPath = (call: Call) => call.url.replace('http://api.internal:4000/api/v1/', '');

describe('forwarding', () => {
  it('sends the access cookie as a Bearer token and never forwards cookies', async () => {
    const { deps, calls } = setup(() => json({ data: [1, 2] }, 200, { 'x-request-id': 'req-1' }));
    const res = await run(
      request('orders?limit=5&q=sofa', {
        cookies: { bms_at: 'tok', bms_rt: 'rt', other: 'x' },
        headers: {
          authorization: 'Bearer attacker',
          'user-agent': 'jest',
          'x-forwarded-for': '1.2.3.4',
        },
      }),
      deps,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ data: [1, 2] });
    expect(res.headers.get('x-request-id')).toBe('req-1');
    expect(res.headers.getSetCookie()).toEqual([]);
    expect(calls).toHaveLength(1);
    expect(apiPath(calls[0]!)).toBe('orders?limit=5&q=sofa');
    expect(calls[0]!.headers.get('authorization')).toBe('Bearer tok');
    expect(calls[0]!.headers.get('cookie')).toBeNull();
    expect(calls[0]!.headers.get('user-agent')).toBe('jest');
    expect(calls[0]!.headers.get('x-forwarded-for')).toBe('1.2.3.4');
  });

  it('passes JSON bodies, idempotency keys and error answers through', async () => {
    const { deps, calls } = setup(() => apiError(422, 'TRANSITION_NOT_ALLOWED'));
    const res = await run(
      request('orders/o1/status', {
        method: 'POST',
        cookies: { bms_at: 'tok' },
        headers: { 'content-type': 'application/json', 'idempotency-key': 'k1' },
        body: JSON.stringify({ to: 'x' }),
      }),
      deps,
    );
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe('TRANSITION_NOT_ALLOWED');
    expect(calls[0]!.body).toBe('{"to":"x"}');
    expect(calls[0]!.headers.get('idempotency-key')).toBe('k1');
    expect(calls[0]!.headers.get('content-type')).toBe('application/json');
  });

  it('streams binary documents with their type and filename', async () => {
    const bytes = new Uint8Array([37, 80, 68, 70, 0, 255, 1]);
    const { deps } = setup(
      () =>
        new Response(bytes, {
          headers: {
            'content-type': 'application/pdf',
            'content-disposition': 'inline; filename="a.pdf"',
          },
        }),
    );
    const res = await run(
      request('documents/receipts/r1/pdf', { cookies: { bms_at: 'tok' } }),
      deps,
    );
    expect(res.headers.get('content-type')).toBe('application/pdf');
    expect(res.headers.get('content-disposition')).toContain('a.pdf');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
  });

  it('forwards multipart uploads untouched', async () => {
    const { deps, calls } = setup(() => json({ data: { id: 'f1' } }, 201));
    const form = new FormData();
    form.set('file', new Blob(['hello'], { type: 'image/png' }), 'a.png');
    const req = request('files', { method: 'POST', cookies: { bms_at: 'tok' }, body: form });
    const res = await run(req, deps);
    expect(res.status).toBe(201);
    expect(calls[0]!.headers.get('content-type')).toMatch(/^multipart\/form-data; boundary=/);
    expect(calls[0]!.body).toContain('hello');
  });

  it('handles empty answers', async () => {
    const { deps } = setup(() => new Response(null, { status: 204 }));
    const res = await run(
      request('auth/password/change', { method: 'POST', cookies: { bms_at: 'tok' } }),
      deps,
    );
    expect(res.status).toBe(204);
  });

  it('answers 502 in the standard envelope when the API is unreachable', async () => {
    const { deps } = setup(() => {
      throw new Error('ECONNREFUSED');
    });
    const res = await run(request('orders', { cookies: { bms_at: 'tok' } }), deps);
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ code: 'EXTERNAL_SERVICE_FAILED', requestId: 'bff' });
  });

  it.each(['..', '.', 'a%2Fb', 'a b', ''])(
    'rejects the unsafe path segment %p',
    async (segment) => {
      const { deps, calls } = setup(() => json({ data: 1 }));
      const res = await handleBff(
        request('x', { cookies: { bms_at: 'tok' } }),
        ['orders', segment],
        deps,
      );
      expect(res.status).toBe(404);
      expect(calls).toHaveLength(0);
    },
  );

  it('does not expose the refresh endpoint to the browser', async () => {
    const { deps, calls } = setup(() => json({ data: PAIR }));
    const res = await run(
      request('auth/refresh', {
        method: 'POST',
        cookies: { bms_rt: 'rt' },
        body: '{"refreshToken":"rt"}',
      }),
      deps,
    );
    expect(res.status).toBe(404);
    expect(calls).toHaveLength(0);
  });
});

describe('silent refresh (design: Web session)', () => {
  const refreshAware = (okAfterRefresh = true) =>
    setup((call) => {
      if (apiPath(call) === 'auth/refresh')
        return okAfterRefresh ? json({ data: PAIR }) : apiError(401, 'UNAUTHENTICATED');
      return call.headers.get('authorization') === 'Bearer new-access'
        ? json({ data: 'secret data' })
        : apiError(401, 'TOKEN_EXPIRED');
    });

  it.each(['TOKEN_EXPIRED', 'TOKEN_STALE'])(
    'refreshes on %s, retries once and sets the new cookies',
    async (code) => {
      const { deps, calls } = setup((call) => {
        if (apiPath(call) === 'auth/refresh') return json({ data: PAIR });
        return call.headers.get('authorization') === 'Bearer new-access'
          ? json({ data: 'ok' })
          : apiError(401, code);
      });
      const res = await run(
        request('orders', { cookies: { bms_at: 'old', bms_rt: 'old-rt' } }),
        deps,
      );
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ data: 'ok' });
      expect(calls.map(apiPath)).toEqual(['orders', 'auth/refresh', 'orders']);
      expect(JSON.parse(calls[1]!.body as string)).toEqual({ refreshToken: 'old-rt' });

      const at = cookie(res, 'bms_at')!;
      const rt = cookie(res, 'bms_rt')!;
      expect(at).toContain('bms_at=new-access');
      expect(at).toMatch(/HttpOnly/i);
      expect(at).toMatch(/SameSite=lax/i);
      expect(at).toMatch(/Path=\//);
      expect(at).toMatch(/Max-Age=900/);
      expect(rt).toContain('bms_rt=new-refresh');
      expect(rt).toMatch(/Max-Age=2592000/);
    },
  );

  it('refreshes first when only the refresh cookie is left (the access cookie has expired)', async () => {
    const { deps, calls } = refreshAware();
    const res = await run(request('orders', { cookies: { bms_rt: 'old-rt' } }), deps);
    expect(res.status).toBe(200);
    expect(calls.map(apiPath)).toEqual(['auth/refresh', 'orders']);
    expect(cookie(res, 'bms_at')).toContain('new-access');
  });

  it('ends the session when the refresh token is rejected: 401 and cookies cleared', async () => {
    const { deps } = refreshAware(false);
    const res = await run(request('orders', { cookies: { bms_at: 'old', bms_rt: 'dead' } }), deps);
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('UNAUTHENTICATED');
    expect(cookie(res, 'bms_at')).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);
    expect(cookie(res, 'bms_rt')).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);
  });

  it('answers 401 and clears cookies when there is no session at all', async () => {
    const { deps } = setup(() => apiError(401, 'UNAUTHENTICATED'));
    const res = await run(request('orders'), deps);
    expect(res.status).toBe(401);
    expect(cookie(res, 'bms_at')).toBeDefined();
  });

  it('does not refresh for other 401s (a different failure is not an expired token)', async () => {
    const { deps, calls } = setup(() => apiError(401, 'INVALID_CREDENTIALS'));
    const res = await run(request('orders', { cookies: { bms_at: 'tok', bms_rt: 'rt' } }), deps);
    expect(res.status).toBe(401);
    expect(calls.map(apiPath)).toEqual(['orders']);
  });

  it('five simultaneous requests share ONE refresh (a second use of the token would end the session)', async () => {
    const { deps, calls } = setup(async (call) => {
      if (apiPath(call) === 'auth/refresh') {
        await new Promise((r) => setTimeout(r, 20));
        return json({ data: PAIR });
      }
      return call.headers.get('authorization') === 'Bearer new-access'
        ? json({ data: 'ok' })
        : apiError(401, 'TOKEN_EXPIRED');
    });
    const responses = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        run(request(`orders/${i}`, { cookies: { bms_at: 'old', bms_rt: 'old-rt' } }), deps),
      ),
    );
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(calls.filter((c) => apiPath(c) === 'auth/refresh')).toHaveLength(1);
    for (const r of responses) expect(cookie(r, 'bms_at')).toContain('new-access');
  });

  it('a request still carrying the old token right after rotation reuses the new pair instead of presenting the old one again', async () => {
    const { deps, calls } = refreshAware();
    await run(request('orders', { cookies: { bms_at: 'old', bms_rt: 'old-rt' } }), deps);
    const late = await run(
      request('orders/2', { cookies: { bms_at: 'old', bms_rt: 'old-rt' } }),
      deps,
    );
    expect(late.status).toBe(200);
    expect(calls.filter((c) => apiPath(c) === 'auth/refresh')).toHaveLength(1);
  });
});

describe('cross-site request protection', () => {
  const ok = () => setup(() => json({ data: 'done' }));

  it.each([
    ['no Origin header', null],
    ['another site', 'https://evil.example'],
    ['same host, other scheme', 'https://localhost:3000'],
    ['same host, other port', 'http://localhost:3001'],
  ])('blocks a state-changing request with %s', async (_label, origin) => {
    const { deps, calls } = ok();
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE']) {
      const res = await run(
        request('orders', { method, cookies: { bms_at: 'tok' }, origin }),
        deps,
      );
      expect(res.status).toBe(403);
    }
    expect(calls).toHaveLength(0);
  });

  it('allows the site’s own origin, and does not check reads', async () => {
    const { deps, calls } = ok();
    expect(
      (await run(request('orders', { method: 'POST', cookies: { bms_at: 'tok' } }), deps)).status,
    ).toBe(200);
    expect((await run(request('orders', { cookies: { bms_at: 'tok' } }), deps)).status).toBe(200);
    expect(calls).toHaveLength(2);
  });

  it('works behind a reverse proxy that terminates TLS', async () => {
    const { deps } = ok();
    const headers = { 'x-forwarded-host': 'app.example.com', 'x-forwarded-proto': 'https' };
    const good = await run(
      request('orders', {
        method: 'POST',
        cookies: { bms_at: 'tok' },
        headers,
        origin: 'https://app.example.com',
      }),
      deps,
    );
    expect(good.status).toBe(200);
    const bad = await run(
      request('orders', {
        method: 'POST',
        cookies: { bms_at: 'tok' },
        headers,
        origin: 'http://localhost:3000',
      }),
      deps,
    );
    expect(bad.status).toBe(403);
  });
});

describe('tokens never reach browser JavaScript', () => {
  const loginOk = () => json({ data: { requiresWorkspaceSelection: false, ...PAIR } });

  it('login: tokens become HTTP-only cookies and are removed from the body', async () => {
    const { deps, calls } = setup(loginOk);
    const res = await run(
      request('auth/login', {
        method: 'POST',
        body: JSON.stringify({ email: 'a@b.c', password: 'pw' }),
        headers: { 'content-type': 'application/json' },
      }),
      deps,
    );
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ data: { requiresWorkspaceSelection: false } });
    expect(text).not.toContain('new-access');
    expect(text).not.toContain('new-refresh');
    expect(cookie(res, 'bms_at')).toMatch(/HttpOnly/i);
    expect(cookie(res, 'bms_rt')).toMatch(/HttpOnly/i);
    expect(calls[0]!.headers.get('authorization')).toBeNull();
    expect(calls).toHaveLength(1); // login is public: no refresh dance
  });

  it('login with several workspaces: ticket and list stay in short-lived HTTP-only cookies; the body has names only', async () => {
    const { deps } = setup(() =>
      json({
        data: {
          requiresWorkspaceSelection: true,
          loginTicket: 'ticket-xyz',
          workspaces: [
            { id: 'w1', name: 'Acme' },
            { id: 'w2', name: 'Beta' },
          ],
        },
      }),
    );
    const res = await run(request('auth/login', { method: 'POST', body: '{}' }), deps);
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({
      data: {
        requiresWorkspaceSelection: true,
        workspaces: [
          { id: 'w1', name: 'Acme' },
          { id: 'w2', name: 'Beta' },
        ],
      },
    });
    expect(text).not.toContain('ticket-xyz');
    const ticket = cookie(res, 'bms_lt')!;
    expect(ticket).toContain('bms_lt=ticket-xyz');
    expect(ticket).toMatch(/HttpOnly/i);
    expect(ticket).toMatch(/Path=\/api\/bff/);
    expect(ticket).toMatch(/Max-Age=300/);
    expect(cookie(res, 'bms_at')).toBeUndefined();
  });

  it('select-workspace: the BFF supplies the ticket from its cookie and ignores one sent by the browser', async () => {
    const { deps, calls } = setup(loginOk);
    const res = await run(
      request('auth/select-workspace', {
        method: 'POST',
        cookies: { bms_lt: 'real-ticket' },
        body: JSON.stringify({ workspaceId: 'w2', loginTicket: 'forged' }),
        headers: { 'content-type': 'application/json' },
      }),
      deps,
    );
    expect(res.status).toBe(200);
    expect(JSON.parse(calls[0]!.body as string)).toEqual({
      loginTicket: 'real-ticket',
      workspaceId: 'w2',
    });
    expect(cookie(res, 'bms_at')).toContain('new-access');
    expect(cookie(res, 'bms_lt')).toMatch(/Max-Age=0/);
    expect(await res.text()).not.toContain('new-access');
  });

  it('select-workspace without a ticket cookie asks the user to sign in again', async () => {
    const { deps, calls } = setup(loginOk);
    const res = await run(
      request('auth/select-workspace', {
        method: 'POST',
        body: '{"workspaceId":"w1"}',
        headers: { 'content-type': 'application/json' },
      }),
      deps,
    );
    expect(res.status).toBe(401);
    expect(calls).toHaveLength(0);
  });

  it('switch-workspace replaces the session cookies', async () => {
    const { deps } = setup(loginOk);
    const res = await run(
      request('auth/switch-workspace', {
        method: 'POST',
        cookies: { bms_at: 'tok' },
        body: '{"workspaceId":"w2"}',
        headers: { 'content-type': 'application/json' },
      }),
      deps,
    );
    expect(cookie(res, 'bms_at')).toContain('new-access');
    expect(await res.text()).not.toContain('new-refresh');
  });

  it('failed logins pass through untouched, with no cookies', async () => {
    const { deps } = setup(() => apiError(401, 'INVALID_CREDENTIALS'));
    const res = await run(request('auth/login', { method: 'POST', body: '{}' }), deps);
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe('INVALID_CREDENTIALS');
    expect(res.headers.getSetCookie()).toEqual([]);
  });

  it('logout clears the cookies even when the API answers with no content', async () => {
    const { deps, calls } = setup(() => new Response(null, { status: 204 }));
    const res = await run(
      request('auth/logout', { method: 'POST', cookies: { bms_at: 'tok', bms_rt: 'rt' } }),
      deps,
    );
    expect(res.status).toBe(204);
    expect(calls[0]!.headers.get('authorization')).toBe('Bearer tok');
    expect(cookie(res, 'bms_at')).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);
    expect(cookie(res, 'bms_rt')).toMatch(/Max-Age=0|Expires=Thu, 01 Jan 1970/i);
  });

  it('marks cookies Secure when the browser used HTTPS, and not otherwise', async () => {
    const { deps } = setup(loginOk);
    const https = await run(
      request('auth/login', {
        method: 'POST',
        body: '{}',
        headers: { 'x-forwarded-proto': 'https', 'x-forwarded-host': 'app.example.com' },
        origin: 'https://app.example.com',
      }),
      deps,
    );
    expect(cookie(https, 'bms_at')).toMatch(/Secure/i);
    const http = await run(request('auth/login', { method: 'POST', body: '{}' }), deps);
    expect(cookie(http, 'bms_at')).not.toMatch(/Secure/i);
  });

  it('answers a malformed login result with an error rather than leaking it', async () => {
    const { deps } = setup(() => json({ data: { something: 'else' } }));
    const res = await run(request('auth/login', { method: 'POST', body: '{}' }), deps);
    expect(res.status).toBe(502);
  });
});
