import { describe, expect, it, vi } from 'vitest';
import { invalidateAuthority, resetUserScopedCache } from '@/lib/query-cache';

function stub() {
  return { clear: vi.fn() };
}

type InvalidateFilters = { queryKey?: readonly unknown[]; refetchType?: string };

function authorityStub() {
  return { invalidateQueries: vi.fn<(filters?: InvalidateFilters) => Promise<void>>() };
}

function filtersOf(
  queryClient: ReturnType<typeof authorityStub>,
): (InvalidateFilters | undefined)[] {
  return queryClient.invalidateQueries.mock.calls.map(([filters]) => filters);
}

describe('invalidateAuthority', () => {
  // The payloads resolve from the same layers (org plan, role profile, seat,
  // personal plan, overrides, flags), so dropping some of them leaves the rest
  // quoting the pre-change answer (ADR-0015 §7.1, §13 batch 7).
  it('invalidates the six authority prefixes in order', () => {
    const queryClient = authorityStub();

    invalidateAuthority(queryClient);

    expect(filtersOf(queryClient).map((filters) => filters?.queryKey)).toEqual([
      ['permissions'],
      ['entitlements'],
      ['me', 'plan'],
      ['me', 'personal-plan'],
      ['ai'],
      ['question-reports'],
    ]);
  });

  it('marks the org-partitioned pair stale without refetching on an org switch', () => {
    const queryClient = authorityStub();

    invalidateAuthority(queryClient, { refetchPartitioned: false });

    const calls = filtersOf(queryClient);
    expect(calls.slice(0, 2)).toEqual([
      { queryKey: ['permissions'], refetchType: 'none' },
      { queryKey: ['entitlements'], refetchType: 'none' },
    ]);
    // The single-entry keys are not org-partitioned, so they pass no type and
    // keep the default `'active'` refetch (R45 only concerns the switch).
    expect(calls.slice(2).map((filters) => filters?.refetchType)).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
    ]);
  });

  it('refetches the org-partitioned pair when the key did not change', () => {
    const queryClient = authorityStub();

    invalidateAuthority(queryClient);

    const [permissions, entitlements] = filtersOf(queryClient);
    expect(permissions?.refetchType).toBe('active');
    expect(entitlements?.refetchType).toBe('active');
  });
});

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
