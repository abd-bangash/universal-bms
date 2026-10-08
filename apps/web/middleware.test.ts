/** @jest-environment node */
import { NextRequest } from 'next/server';
import { middleware } from './middleware';

const req = (path: string, cookie?: string) =>
  new NextRequest(`http://localhost:3000${path}`, { headers: cookie ? { cookie } : {} });

describe('middleware', () => {
  it('sends visitors without a session to login and remembers the page', () => {
    const res = middleware(req('/orders/123?tab=payments'));
    expect(res.status).toBe(307);
    expect(res.headers.get('location')).toBe(
      'http://localhost:3000/login?returnTo=%2Forders%2F123%3Ftab%3Dpayments',
    );
  });

  it('lets the sign-in pages through', () => {
    for (const path of ['/login', '/select-workspace', '/invite/abc', '/reset-password']) {
      expect(middleware(req(path)).headers.get('location')).toBeNull();
    }
  });

  it('lets signed-in visitors through, with either cookie (the access cookie may have expired)', () => {
    expect(middleware(req('/orders', 'bms_at=x')).headers.get('location')).toBeNull();
    expect(middleware(req('/orders', 'bms_rt=x')).headers.get('location')).toBeNull();
    expect(middleware(req('/', 'other=x')).headers.get('location')).toContain('/login');
  });

  it('does not treat look-alike paths as public', () => {
    expect(middleware(req('/loginx')).headers.get('location')).toContain('/login?returnTo=');
    expect(middleware(req('/invitees')).headers.get('location')).toContain('/login?returnTo=');
  });
});
