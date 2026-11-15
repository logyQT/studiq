import type { BillingSubscriptionView } from '@studiq/server/services/billing.service';
import {
  BILLING_SUCCESS_POLL_ATTEMPTS,
  BILLING_SUCCESS_POLL_INTERVAL_MS,
  dashboardPathForAccountType,
  isActivatedSubscription,
  pollBillingActivation,
} from '@/lib/billing-success';
import { describe, expect, it, vi, type Mock } from 'vitest';
import { firstRecorded } from '#test/mocks/recorded';

function view(overrides: Partial<BillingSubscriptionView> = {}): BillingSubscriptionView {
  return {
    provider: 'stripe',
    planKey: 'spark',
    planName: 'StudiQ Spark',
    billedPlanKey: 'spark',
    billedPlanName: 'StudiQ Spark',
    entitlementAppliedPlanKey: 'spark',
    status: 'active',
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    pendingPlanKey: null,
    priceMonthly: 999,
    currency: 'PLN',
    canManagePortal: true,
    canChangePlan: true,
    canCancel: true,
    hostedInvoiceUrl: null,
    ...overrides,
  };
}

interface Deps {
  reconcile: Mock;
  readSubscription: Mock;
  expectedPlanKey: string | null;
  sleep: Mock;
  isCancelled: Mock;
}

function deps(overrides: Partial<Deps> = {}): Deps {
  return {
    reconcile: vi.fn().mockResolvedValue(undefined),
    readSubscription: vi.fn().mockResolvedValue(view()),
    expectedPlanKey: 'spark',
    sleep: vi.fn().mockResolvedValue(undefined),
    isCancelled: vi.fn().mockReturnValue(false),
    ...overrides,
  };
}

describe('isActivatedSubscription', () => {
  it('requires a plan and a live status', () => {
    expect(isActivatedSubscription(view())).toBe(true);
    expect(isActivatedSubscription(view({ status: 'past_due' }))).toBe(true);
    expect(isActivatedSubscription(view({ status: 'free' }))).toBe(false);
    expect(isActivatedSubscription(view({ status: 'canceled' }))).toBe(false);
    expect(isActivatedSubscription(view({ planKey: null }))).toBe(false);
    expect(isActivatedSubscription(view({ entitlementAppliedPlanKey: null }))).toBe(false);
  });
});

describe('pollBillingActivation', () => {
  it('reconciles once before the first subscription read', async () => {
    const d = deps();

    await pollBillingActivation(d);

    expect(d.reconcile).toHaveBeenCalledTimes(1);
    expect(firstRecorded(d.reconcile.mock.invocationCallOrder)).toBeLessThan(
      firstRecorded(d.readSubscription.mock.invocationCallOrder),
    );
  });

  it('returns the activated plan and stops polling', async () => {
    const d = deps();

    await expect(pollBillingActivation(d)).resolves.toEqual({
      state: 'activated',
      subscription: view(),
    });
    expect(d.readSubscription).toHaveBeenCalledTimes(1);
    expect(d.sleep).not.toHaveBeenCalled();
  });

  it('requires the polled plan to match the purchased plan', async () => {
    const d = deps({
      expectedPlanKey: 'ace',
      readSubscription: vi.fn().mockResolvedValue(view({ planKey: 'spark' })),
    });

    await expect(pollBillingActivation(d)).resolves.toEqual({ state: 'timeout' });
    expect(d.readSubscription).toHaveBeenCalledTimes(BILLING_SUCCESS_POLL_ATTEMPTS);
  });

  it('matches a purchased plan even when the effective plan is a seat plan', async () => {
    const d = deps({
      expectedPlanKey: 'spark',
      readSubscription: vi
        .fn()
        .mockResolvedValue(
          view({ planKey: 'ace', planName: 'StudiQ Ace', billedPlanKey: 'spark' }),
        ),
    });

    await expect(pollBillingActivation(d)).resolves.toMatchObject({ state: 'activated' });
  });

  it('does not treat the effective plan as the billed plan', async () => {
    const d = deps({
      expectedPlanKey: 'ace',
      readSubscription: vi.fn().mockResolvedValue(view({ planKey: 'ace', billedPlanKey: 'spark' })),
    });

    await expect(pollBillingActivation(d)).resolves.toEqual({ state: 'timeout' });
  });

  it('does not activate on a matching billed mirror before the entitlement commits', async () => {
    const d = deps({
      expectedPlanKey: 'spark',
      readSubscription: vi.fn().mockResolvedValue(
        view({
          planKey: 'base',
          planName: 'StudiQ Base',
          billedPlanKey: 'spark',
          billedPlanName: 'StudiQ Spark',
          entitlementAppliedPlanKey: null,
          status: 'active',
        }),
      ),
    });

    await expect(pollBillingActivation(d)).resolves.toEqual({ state: 'timeout' });
    expect(d.readSubscription).toHaveBeenCalledTimes(BILLING_SUCCESS_POLL_ATTEMPTS);
  });

  it('falls back to any live plan when the success URL has no plan id', async () => {
    const d = deps({ expectedPlanKey: null });

    await expect(pollBillingActivation(d)).resolves.toMatchObject({ state: 'activated' });
  });

  it('keeps polling while the read model is free', async () => {
    const d = deps({
      readSubscription: vi
        .fn()
        .mockResolvedValueOnce(view({ planKey: 'base', status: 'free' }))
        .mockResolvedValueOnce(view({ status: 'active' })),
    });

    await expect(pollBillingActivation(d)).resolves.toMatchObject({ state: 'activated' });
    expect(d.readSubscription).toHaveBeenCalledTimes(2);
  });

  it('ignores an active view with no plan', async () => {
    const d = deps({
      readSubscription: vi
        .fn()
        .mockResolvedValueOnce(view({ planKey: null, planName: null }))
        .mockResolvedValueOnce(view()),
    });

    await expect(pollBillingActivation(d)).resolves.toMatchObject({ state: 'activated' });
    expect(d.readSubscription).toHaveBeenCalledTimes(2);
  });

  it('tolerates a failed reconcile and still observes the webhook result', async () => {
    const d = deps({ reconcile: vi.fn().mockRejectedValue(new Error('403')) });

    await expect(pollBillingActivation(d)).resolves.toMatchObject({ state: 'activated' });
  });

  it('recovers from a transient read failure', async () => {
    const d = deps({
      readSubscription: vi
        .fn()
        .mockRejectedValueOnce(new Error('offline'))
        .mockResolvedValueOnce(view()),
    });

    await expect(pollBillingActivation(d)).resolves.toMatchObject({ state: 'activated' });
    expect(d.sleep).toHaveBeenCalledTimes(1);
  });

  it('sleeps between attempts but never after the final one', async () => {
    const d = deps({ readSubscription: vi.fn().mockResolvedValue(view({ status: 'free' })) });

    await expect(pollBillingActivation(d)).resolves.toEqual({ state: 'timeout' });
    expect(d.readSubscription).toHaveBeenCalledTimes(BILLING_SUCCESS_POLL_ATTEMPTS);
    expect(d.sleep).toHaveBeenCalledTimes(BILLING_SUCCESS_POLL_ATTEMPTS - 1);
    expect(d.sleep).toHaveBeenCalledWith(BILLING_SUCCESS_POLL_INTERVAL_MS);
  });

  it('finishes inside the 15 second budget', () => {
    expect(
      (BILLING_SUCCESS_POLL_ATTEMPTS - 1) * BILLING_SUCCESS_POLL_INTERVAL_MS,
    ).toBeLessThanOrEqual(15_000);
  });

  it('stops before reading when the caller is already cancelled', async () => {
    const d = deps({ isCancelled: vi.fn().mockReturnValue(true) });

    await expect(pollBillingActivation(d)).resolves.toEqual({ state: 'cancelled' });
    expect(d.readSubscription).not.toHaveBeenCalled();
  });

  it('stops when the caller is cancelled during a sleep', async () => {
    let cancelled = false;
    const d = deps({
      readSubscription: vi.fn().mockResolvedValue(view({ status: 'free' })),
      isCancelled: () => cancelled,
      sleep: vi.fn().mockImplementation(() => {
        cancelled = true;
        return Promise.resolve();
      }),
    });

    await expect(pollBillingActivation(d)).resolves.toEqual({ state: 'cancelled' });
    expect(d.readSubscription).toHaveBeenCalledTimes(1);
  });
});

describe('dashboardPathForAccountType', () => {
  it('routes each account type to its dashboard', () => {
    expect(dashboardPathForAccountType('manager')).toBe('/manage');
    expect(dashboardPathForAccountType('educator')).toBe('/edu');
    expect(dashboardPathForAccountType('student')).toBe('/app');
    expect(dashboardPathForAccountType(undefined)).toBe('/edu');
  });
});
