import { describe, expect, it } from 'vitest';
import { toSafeInternalPath } from '@/lib/safe-redirect';

const BASE = 'http://localhost:3000';

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
});
