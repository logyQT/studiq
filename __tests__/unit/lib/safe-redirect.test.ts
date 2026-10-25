import { describe, expect, it } from 'vitest';
import { toSafeInternalPath } from '@/lib/safe-redirect';

const BASE = 'http://localhost:3000';

/**
 * Every accepted value is re-resolved by the consumers (`new URL(next, base)` in
 * the proxy and `router.replace(next)` on the login page), so the invariant we
 * actually need is: a non-null result must still be same-origin *after* that
 * second parse.
 */
function assertSameOrigin(result: string | null) {
  if (result === null) return;
  expect(new URL(result, BASE).origin).toBe(BASE);
}

describe('toSafeInternalPath', () => {
  it('keeps an internal path with its query and hash', () => {
    expect(toSafeInternalPath('/app/study/quiz', BASE)).toBe('/app/study/quiz');
    expect(toSafeInternalPath('/app/study/quiz?type=open&n=2#top', BASE)).toBe(
      '/app/study/quiz?type=open&n=2#top',
    );
  });

  it('reduces an absolute same-origin URL to its path', () => {
    expect(toSafeInternalPath('http://localhost:3000/app/study/quiz?x=1', BASE)).toBe(
      '/app/study/quiz?x=1',
    );
  });

  it('keeps internal double slashes (they are same-origin)', () => {
    expect(toSafeInternalPath('/app//x', BASE)).toBe('/app//x');
    expect(toSafeInternalPath('/app/a//b', BASE)).toBe('/app/a//b');
    expect(toSafeInternalPath('/', BASE)).toBe('/');
  });

  // ---------------------------------------------------------------- negatives
  it.each([
    ['protocol-relative', '//evil.com/x'],
    ['absolute cross-origin', 'https://evil.com/x'],
    ['javascript:', 'javascript:alert(1)'],
    ['empty', ''],
    ['undefined', undefined],
  ])('rejects %s', (_label, raw) => {
    expect(toSafeInternalPath(raw, BASE)).toBeNull();
  });

  /**
   * WHATWG normalisation turns these internal-looking inputs into a
   * `//evil.com` pathname while the parsed origin stays ours, so the origin
   * check alone does not catch them (`new URL('//evil.com', base)` → evil.com).
   */
  it.each([
    ['.//evil.com'],
    ['/..//evil.com'],
    ['/..///evil.com'],
    ['.//evil.com/login'],
    ['..//evil.com'],
    ['/.//evil.com'],
    ['/a/..//evil.com'],
    ['/%2E//evil.com'],
    ['/%2e%2e//evil.com'],
    ['/app/./..//evil.com'],
    ['/app/%2e%2e//evil.com'],
  ])('rejects the normalised protocol-relative path %s', (raw) => {
    expect(toSafeInternalPath(raw, BASE)).toBeNull();
  });

  it('rejects the auth routes (redirect loop)', () => {
    expect(toSafeInternalPath('/login', BASE)).toBeNull();
    expect(toSafeInternalPath('/login/', BASE)).toBeNull();
    expect(toSafeInternalPath('/login?next=/app', BASE)).toBeNull();
    expect(toSafeInternalPath('/register?x=1', BASE)).toBeNull();
  });

  it('rejects API paths (not pages)', () => {
    expect(toSafeInternalPath('/api/v1/features/me', BASE)).toBeNull();
  });

  it('returns null when there is no base to resolve against', () => {
    expect(toSafeInternalPath('/app/study/quiz', '')).toBeNull();
  });

  it('never returns a value that resolves off-origin on a second parse', () => {
    const inputs: (string | null | undefined)[] = [
      '/',
      '/app',
      '/app/study/quiz',
      '/app/study/quiz?type=open#x',
      '/app//x',
      '/app/a//b',
      '/pricing?x=1',
      'http://localhost:3000/app/study/quiz',
      '//evil.com/x',
      '///evil.com',
      'https://evil.com/x',
      'javascript:alert(1)',
      './/evil.com',
      '/..//evil.com',
      '/..///evil.com',
      './/evil.com/login',
      '..//evil.com',
      '/.//evil.com',
      '/a/..//evil.com',
      '/%2E//evil.com',
      '/%2e%2e//evil.com',
      '/app/./..//evil.com',
      '/app/%2e%2e//evil.com',
      '/login',
      '/api/v1/features/me',
      '',
      null,
      undefined,
    ];

    for (const raw of inputs) {
      assertSameOrigin(toSafeInternalPath(raw, BASE));
    }
  });
});
