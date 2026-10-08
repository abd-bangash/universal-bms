import { isPublicPath, loginUrl, sanitizeReturnUrl } from './return-url';

describe('sanitizeReturnUrl', () => {
  it('keeps same-site paths with query and hash', () => {
    expect(sanitizeReturnUrl('/orders/12?tab=pay#top')).toBe('/orders/12?tab=pay#top');
    expect(sanitizeReturnUrl('/')).toBe('/');
  });

  it.each([
    'https://evil.example/x',
    '//evil.example',
    '/\\evil.example',
    'javascript:alert(1)',
    'orders',
    '',
    null,
    undefined,
    'http://localhost/x',
  ])('refuses %p', (value) => {
    expect(sanitizeReturnUrl(value as string | null | undefined)).toBe('/');
  });

  it('does not bounce back to the sign-in pages', () => {
    for (const p of [
      '/login',
      '/login?returnTo=/x',
      '/select-workspace',
      '/invite/abc',
      '/reset-password?token=1',
    ])
      expect(sanitizeReturnUrl(p)).toBe('/');
    expect(sanitizeReturnUrl('/loginx')).toBe('/loginx');
  });

  it('uses the given fallback', () => {
    expect(sanitizeReturnUrl('//x', '/home')).toBe('/home');
  });
});

describe('loginUrl and isPublicPath', () => {
  it('encodes the page to return to', () => {
    expect(loginUrl('/orders?x=1&y=2')).toBe('/login?returnTo=%2Forders%3Fx%3D1%26y%3D2');
  });
  it('knows the pages that work without a session', () => {
    expect(isPublicPath('/login')).toBe(true);
    expect(isPublicPath('/invite/token')).toBe(true);
    expect(isPublicPath('/invite')).toBe(true);
    expect(isPublicPath('/orders')).toBe(false);
    expect(isPublicPath('/loginx')).toBe(false);
  });
});
