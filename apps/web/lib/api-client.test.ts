import { api, browser, redirectToLogin } from './api-client';
import { ApiError } from './errors';
import { jsonResponse, mockFetch } from '../test/render';

describe('api client', () => {
  afterEach(() => jest.restoreAllMocks());

  /** Pretends the browser is at the given page and records navigation. */
  function at(pathname: string, search = '') {
    jest.spyOn(browser, 'pathname').mockReturnValue(pathname);
    jest.spyOn(browser, 'search').mockReturnValue(search);
    return jest.spyOn(browser, 'assign').mockImplementation(() => undefined);
  }

  it('calls the BFF, builds the query string and unwraps the envelope', async () => {
    const fetchMock = mockFetch(() =>
      jsonResponse({ data: [{ id: 'a' }], meta: { nextCursor: 'c1', total: 9 } }),
    );
    const page = await api.getPage<{ id: string }>('/orders', {
      limit: 25,
      q: 'sofa',
      empty: '',
      none: undefined,
      flag: false,
    });
    expect(page).toEqual({ items: [{ id: 'a' }], nextCursor: 'c1', total: 9 });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('/api/bff/orders?limit=25&q=sofa&flag=false');
    expect(init.credentials).toBe('same-origin');
  });

  it('sends JSON bodies and returns data; 204 gives undefined', async () => {
    const fetchMock = mockFetch((_url, init) =>
      init?.method === 'DELETE'
        ? new Response(null, { status: 204 })
        : jsonResponse({ data: { id: 'n1' } }, 201),
    );
    expect(await api.post<{ id: string }>('/customers', { name: 'Ann' })).toEqual({ id: 'n1' });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.body).toBe('{"name":"Ann"}');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    await expect(api.delete('/customers/n1')).resolves.toBeUndefined();
    expect(await api.patch('/customers/n1', { name: 'B' })).toEqual({ id: 'n1' });
  });

  it('turns error envelopes into ApiError with field details', async () => {
    mockFetch(() =>
      jsonResponse(
        {
          statusCode: 400,
          code: 'VALIDATION_FAILED',
          message: 'Validation failed',
          details: { email: ['is required'] },
          requestId: 'r1',
        },
        400,
      ),
    );
    const error = await api.post('/customers', {}).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      status: 400,
      code: 'VALIDATION_FAILED',
      details: { email: ['is required'] },
      requestId: 'r1',
    });
  });

  it('reports network failures and non-JSON failures in the same shape', async () => {
    global.fetch = jest
      .fn()
      .mockRejectedValue(new TypeError('Failed to fetch')) as unknown as typeof fetch;
    await expect(api.get('/x')).rejects.toMatchObject({ code: 'NETWORK_ERROR', status: 0 });
    mockFetch(
      () => new Response('<html>Bad gateway</html>', { status: 502, statusText: 'Bad Gateway' }),
    );
    await expect(api.get('/x')).rejects.toMatchObject({ status: 502, code: 'INTERNAL_ERROR' });
  });

  it('sends the user to login, remembering the page, when the session is gone (Requirement 49.10)', async () => {
    const assign = at('/orders/12', '?tab=pay');
    mockFetch(() =>
      jsonResponse({ statusCode: 401, code: 'UNAUTHENTICATED', message: 'x', requestId: 'r' }, 401),
    );
    await expect(api.get('/orders')).rejects.toBeInstanceOf(ApiError);
    expect(assign).toHaveBeenCalledWith('/login?returnTo=%2Forders%2F12%3Ftab%3Dpay');
  });

  it('does not redirect from the sign-in pages themselves, nor for other 401s', async () => {
    const assign = at('/login');
    mockFetch(() =>
      jsonResponse({ statusCode: 401, code: 'UNAUTHENTICATED', message: 'x', requestId: 'r' }, 401),
    );
    await expect(api.get('/auth/me')).rejects.toBeInstanceOf(ApiError);
    redirectToLogin();
    expect(assign).not.toHaveBeenCalled();

    at('/orders');
    mockFetch(() =>
      jsonResponse(
        { statusCode: 401, code: 'INVALID_CREDENTIALS', message: 'x', requestId: 'r' },
        401,
      ),
    );
    await expect(api.post('/auth/login', {})).rejects.toBeInstanceOf(ApiError);
    expect(assign).not.toHaveBeenCalled();
  });

  it('uploads multipart forms without forcing a content type, and downloads blobs', async () => {
    const fetchMock = mockFetch((url) =>
      url.includes('/pdf')
        ? new Response('PDF', { headers: { 'content-type': 'application/pdf' } })
        : jsonResponse({ data: { id: 'f1' } }, 201),
    );
    const form = new FormData();
    form.set('file', new Blob(['x']), 'a.png');
    expect(await api.upload('/files', form)).toEqual({ id: 'f1' });
    const init = fetchMock.mock.calls[0]?.[1] as RequestInit;
    expect(init.body).toBe(form);
    expect((init.headers as Record<string, string>)['Content-Type']).toBeUndefined();
    expect(await (await api.blob('/documents/x/pdf')).text()).toBe('PDF');
  });
});
