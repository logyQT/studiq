import { describe, expect, it, vi } from 'vitest';
import { resetUserScopedCache } from '@/lib/query-cache';

function stub() {
  return { clear: vi.fn() };
}

describe('resetUserScopedCache', () => {
  it('does not clear on the first resolution (no identity yet)', () => {
    const queryClient = stub();
    expect(resetUserScopedCache(queryClient, undefined, 'u1')).toBe(false);
    expect(resetUserScopedCache(queryClient, undefined, null)).toBe(false);
    expect(queryClient.clear).not.toHaveBeenCalled();
  });

  it('keeps the cache for the same identity', () => {
    const queryClient = stub();
    expect(resetUserScopedCache(queryClient, 'u1', 'u1')).toBe(false);
    expect(resetUserScopedCache(queryClient, null, null)).toBe(false);
    expect(queryClient.clear).not.toHaveBeenCalled();
  });

  it.each([
    ['login', null, 'u1'],
    ['logout', 'u1', null],
    ['account switch', 'u1', 'u2'],
  ])('clears on %s', (_label, previous, next) => {
    const queryClient = stub();
    expect(resetUserScopedCache(queryClient, previous, next)).toBe(true);
    expect(queryClient.clear).toHaveBeenCalledTimes(1);
  });
});
