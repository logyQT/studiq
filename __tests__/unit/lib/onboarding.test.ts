import { describe, expect, it } from 'vitest';
import { resolveNeedsOnboarding } from '@/lib/onboarding';

const settled = { isPending: false, isFetching: false };

describe('resolveNeedsOnboarding', () => {
  it('does not redirect while the first load is still pending', () => {
    expect(
      resolveNeedsOnboarding({
        orgsCount: 0,
        isPending: true,
        isFetching: true,
        accountType: 'educator',
      }),
    ).toBe(false);
  });

  it('does not redirect while refetching over a cached empty list (#305)', () => {
    // The regression: the `[]` cached before the class existed is still the
    // rendered data, but a request is in flight and will return the new org.
    expect(
      resolveNeedsOnboarding({
        orgsCount: 0,
        isPending: false,
        isFetching: true,
        accountType: 'educator',
      }),
    ).toBe(false);
  });

  it('redirects a settled educator with no orgs', () => {
    expect(resolveNeedsOnboarding({ orgsCount: 0, ...settled, accountType: 'educator' })).toBe(
      true,
    );
  });

  it('redirects a settled manager with no orgs', () => {
    expect(resolveNeedsOnboarding({ orgsCount: 0, ...settled, accountType: 'manager' })).toBe(true);
  });

  it('never redirects a student', () => {
    expect(resolveNeedsOnboarding({ orgsCount: 0, ...settled, accountType: 'student' })).toBe(
      false,
    );
  });

  it('never redirects when the caller has orgs', () => {
    expect(resolveNeedsOnboarding({ orgsCount: 1, ...settled, accountType: 'educator' })).toBe(
      false,
    );
  });

  it('never redirects when the account type is unknown', () => {
    expect(resolveNeedsOnboarding({ orgsCount: 0, ...settled, accountType: undefined })).toBe(
      false,
    );
    expect(resolveNeedsOnboarding({ orgsCount: 0, ...settled, accountType: null })).toBe(false);
  });
});
