import { describe, expect, it } from 'vitest';
import { resolveDashboardPath, resolveNeedsOnboarding, resolveSetupGate } from '@/lib/onboarding';

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

describe('resolveSetupGate', () => {
  it('stays on the skeleton while the first load is pending', () => {
    expect(resolveSetupGate({ orgsCount: 0, isPending: true, isFetching: true })).toBe('loading');
  });

  it('stays on the skeleton while refetching over a cached empty list (#305/#310)', () => {
    // The cached `[]` is not proof of onboarding: a request is in flight and may
    // return the org that already exists. Deciding here would flash the chooser.
    expect(resolveSetupGate({ orgsCount: 0, isPending: false, isFetching: true })).toBe('loading');
  });

  it('shows the chooser to a settled caller with no orgs', () => {
    expect(resolveSetupGate({ orgsCount: 0, ...settled })).toBe('onboarding');
  });

  it('sends a settled caller with orgs to the dashboard', () => {
    expect(resolveSetupGate({ orgsCount: 2, ...settled })).toBe('dashboard');
  });

  it('can never ask for the dashboard while /edu would ask for onboarding', () => {
    // Both guards read the same snapshot; if they both fired, /setup <-> /edu
    // would loop. Exhaustive for the staff account types.
    for (const accountType of ['educator', 'manager']) {
      for (const orgsCount of [0, 1, 2]) {
        for (const isPending of [true, false]) {
          for (const isFetching of [true, false]) {
            const gate = resolveSetupGate({ orgsCount, isPending, isFetching });
            const needsOnboarding = resolveNeedsOnboarding({
              orgsCount,
              isPending,
              isFetching,
              accountType,
            });
            expect(gate === 'dashboard' && needsOnboarding).toBe(false);
          }
        }
      }
    }
  });
});

describe('resolveDashboardPath', () => {
  it('sends educators to /edu', () => {
    expect(resolveDashboardPath('educator')).toBe('/edu');
  });

  it('sends managers to /manage', () => {
    expect(resolveDashboardPath('manager')).toBe('/manage');
  });

  it('sends students to /app', () => {
    expect(resolveDashboardPath('student')).toBe('/app');
  });

  it('falls back to /edu when the account type is unknown', () => {
    expect(resolveDashboardPath(undefined)).toBe('/edu');
    expect(resolveDashboardPath(null)).toBe('/edu');
  });
});
