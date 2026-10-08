/** @jest-environment node */
import { isMutating, isSameOrigin, requestOrigin } from './origin';

const url = new URL('http://localhost:3000/api/bff/x');
const h = (init: Record<string, string>) => new Headers(init);

describe('origin helpers', () => {
  it('knows which methods change state', () => {
    for (const m of ['POST', 'put', 'Patch', 'DELETE']) expect(isMutating(m)).toBe(true);
    for (const m of ['GET', 'HEAD', 'OPTIONS']) expect(isMutating(m)).toBe(false);
  });

  it('derives the public origin from the request or from proxy headers', () => {
    expect(requestOrigin(h({}), url)).toBe('http://localhost:3000');
    expect(requestOrigin(h({ host: 'shop.test' }), url)).toBe('http://shop.test');
    expect(
      requestOrigin(
        h({ 'x-forwarded-host': 'app.example.com, internal', 'x-forwarded-proto': 'https, http' }),
        url,
      ),
    ).toBe('https://app.example.com');
  });

  it('accepts only an identical Origin', () => {
    expect(isSameOrigin(h({ origin: 'http://localhost:3000' }), url)).toBe(true);
    expect(isSameOrigin(h({}), url)).toBe(false);
    expect(isSameOrigin(h({ origin: 'null' }), url)).toBe(false);
    expect(isSameOrigin(h({ origin: 'http://localhost:3000.evil.test' }), url)).toBe(false);
  });
});
