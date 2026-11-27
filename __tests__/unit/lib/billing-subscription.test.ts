import { AccountType } from '@studiq/authz';
import type { ChangePlanPreview } from '@studiq/server/lib/payment/payment-gateway';
import type { BillingSubscriptionView } from '@studiq/server/services/billing.service';
import type { PlanInfo } from '@studiq/server/services/subscription-plan.service';
import {
  activatedPlanLabel,
  alternativePlans,
  billingCardRequest,
  billingPlanFamily,
  billingScopeUrl,
  billingStatusKey,
  hasProviderActions,
  invoiceHistoryPath,
  invoiceHref,
  noActionsMessageKey,
  periodRow,
  planChangeFeedback,
  previewPlanChange,
  scheduledCancellationDate,
  seatsSummary,
  submitCancellation,
  withCancellationOverride,
  withPersonalScope,
} from '@/lib/billing-subscription';
import { describe, expect, it } from 'vitest';

function subscription(overrides: Partial<BillingSubscriptionView> = {}): BillingSubscriptionView {
  return {
    provider: 'stripe',
    planKey: 'plus',
    planName: 'StudiQ Plus',
    billedPlanKey: 'plus',
    billedPlanName: 'StudiQ Plus',
    status: 'active',
    currentPeriodEnd: '2026-12-01T00:00:00.000Z',
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

function plan(key: string, overrides: Partial<PlanInfo> = {}): PlanInfo {
  return {
    id: key,
    key,
    name: key,
    description: null,
    priceMonthly: 0,
    priceYearly: 0,
    currency: 'PLN',
    features: [],
    limits: {},
    sortOrder: 0,
    isActive: true,
    scope: 'personal',
    seatEligible: false,
    ...overrides,
  };
}

describe('billingPlanFamily', () => {
  it('maps the three account types to the manager (organization) family and the personal family', () => {
    expect(billingPlanFamily(AccountType.MANAGER)).toBe('manager');
    expect(billingPlanFamily(AccountType.EDUCATOR)).toBe('educator');
    expect(billingPlanFamily(AccountType.STUDENT)).toBe('student');
  });
});

describe('alternativePlans', () => {
  it('keeps every paid personal plan, excluding the current plan', () => {
    const options = alternativePlans(
      [
        plan('free', { priceMonthly: 0 }),
        plan('pro', { priceMonthly: 3999 }),
        plan('max', { priceMonthly: 7999 }),
        plan('plus', { priceMonthly: 1999 }),
      ],
      subscription(),
      AccountType.STUDENT,
    );

    expect(options.map((option) => option.key)).toEqual(['pro', 'max']);
  });

  it('excludes the billed plan even when the effective plan is a seat plan', () => {
    const options = alternativePlans(
      [plan('plus', { priceMonthly: 1999 }), plan('max', { priceMonthly: 7999 })],
      subscription({ planKey: 'pro', planName: 'StudiQ Pro', billedPlanKey: 'plus' }),
      AccountType.STUDENT,
    );

    expect(options.map((option) => option.key)).toEqual(['max']);
  });

  it('returns an empty list without a catalogue', () => {
    expect(alternativePlans(undefined, subscription(), AccountType.STUDENT)).toEqual([]);
  });

  it('keeps paid organization plans for a manager, excluding the current plan (D34)', () => {
    const options = alternativePlans(
      [
        plan('launch', { priceMonthly: 0, scope: 'organization' }),
        plan('hub', { priceMonthly: 29900, scope: 'organization' }),
        plan('campus', { priceMonthly: 69900, scope: 'organization' }),
        plan('plus', { priceMonthly: 1999 }),
      ],
      subscription({ planKey: 'launch', billedPlanKey: 'launch' }),
      AccountType.MANAGER,
    );

    expect(options.map((option) => option.key)).toEqual(['hub', 'campus']);
  });
});

describe('billingStatusKey', () => {
  it('maps every modeled status to a translation key', () => {
    for (const status of [
      'active',
      'trialing',
      'past_due',
      'unpaid',
      'canceled',
      'incomplete',
      'incomplete_expired',
      'paused',
      'free',
      'none',
    ]) {
      expect(billingStatusKey(status)).toBe(`status_${status}`);
    }
  });

  it('returns null for an unknown provider status', () => {
    expect(billingStatusKey('mystery')).toBeNull();
  });
});

describe('periodRow', () => {
  it('uses the renewal message for a live subscription', () => {
    expect(periodRow(subscription())).toEqual({
      labelKey: 'period_label',
      messageKey: 'renews_on',
      date: '2026-12-01T00:00:00.000Z',
    });
  });

  it('leaves the cancellation date to the explicit cancellation row', () => {
    expect(periodRow(subscription({ cancelAtPeriodEnd: true }))).toBeNull();
  });

  it('hides the row without a period or for a canceled subscription', () => {
    expect(periodRow(subscription({ currentPeriodEnd: null }))).toBeNull();
    expect(periodRow(subscription({ status: 'canceled' }))).toBeNull();
    expect(periodRow(subscription({ status: 'incomplete_expired' }))).toBeNull();
  });
});

describe('scheduledCancellationDate', () => {
  it('returns the date access ends when cancellation is scheduled', () => {
    expect(scheduledCancellationDate(subscription({ cancelAtPeriodEnd: true }))).toBe(
      '2026-12-01T00:00:00.000Z',
    );
  });

  it('returns null without a scheduled cancellation or a period', () => {
    expect(scheduledCancellationDate(subscription())).toBeNull();
    expect(
      scheduledCancellationDate(subscription({ cancelAtPeriodEnd: true, currentPeriodEnd: null })),
    ).toBeNull();
  });

  it('does not report a cancellation date for a subscription that already ended', () => {
    expect(
      scheduledCancellationDate(subscription({ cancelAtPeriodEnd: true, status: 'canceled' })),
    ).toBeNull();
  });
});

describe('provider action copy', () => {
  it('detects whether any provider action is available', () => {
    expect(hasProviderActions(subscription())).toBe(true);
    expect(
      hasProviderActions(
        subscription({ canManagePortal: false, canChangePlan: false, canCancel: false }),
      ),
    ).toBe(false);
  });

  it('explains a mock, a non-admin org member and a never-bought account', () => {
    expect(noActionsMessageKey(subscription({ provider: 'mock' }))).toBe('mock_billing_note');
    expect(
      noActionsMessageKey(
        subscription({
          canManagePortal: false,
          canChangePlan: false,
          canCancel: false,
        }),
      ),
    ).toBe('no_manage_permission');
    expect(
      noActionsMessageKey(
        subscription({
          planKey: null,
          planName: null,
          status: 'none',
        }),
      ),
    ).toBe('no_billing_account');
  });
});

describe('activatedPlanLabel', () => {
  it('confirms the billed plan, never the effective seat plan', () => {
    expect(
      activatedPlanLabel(
        subscription({
          planKey: 'pro',
          planName: 'StudiQ Pro',
          billedPlanKey: 'plus',
          billedPlanName: 'StudiQ Plus',
        }),
      ),
    ).toBe('StudiQ Plus');
  });

  it('returns null when the billed plan has no catalogue name', () => {
    expect(activatedPlanLabel(subscription({ billedPlanName: null }))).toBeNull();
    expect(activatedPlanLabel(undefined)).toBeNull();
  });
});

describe('invoiceHref', () => {
  it('returns only a non-empty Stripe-hosted URL', () => {
    expect(invoiceHref('https://invoice.stripe.test/in_1')).toBe(
      'https://invoice.stripe.test/in_1',
    );
    expect(invoiceHref(null)).toBeNull();
    expect(invoiceHref('')).toBeNull();
    expect(invoiceHref('   ')).toBeNull();
  });
});

describe('seatsSummary', () => {
  it('sums purchased and assigned seats', () => {
    expect(
      seatsSummary([
        { total: 10, assigned: 4 },
        { total: 5, assigned: 1 },
      ]),
    ).toEqual({
      used: 5,
      total: 15,
      visible: true,
    });
  });

  it('hides an empty seats row', () => {
    expect(seatsSummary(undefined)).toEqual({ used: 0, total: 0, visible: false });
    expect(seatsSummary([])).toEqual({ used: 0, total: 0, visible: false });
  });
});

describe('planChangeFeedback', () => {
  it('maps applied and scheduled to success messages', () => {
    expect(planChangeFeedback({ status: 'applied' })).toEqual({
      messageKey: 'change_plan_applied',
      tone: 'success',
      hostedInvoiceUrl: null,
    });
    expect(planChangeFeedback({ status: 'scheduled' })).toMatchObject({
      messageKey: 'change_plan_scheduled',
      tone: 'success',
    });
  });

  it('maps pending_payment to an info message with the hosted invoice', () => {
    expect(
      planChangeFeedback({
        status: 'pending_payment',
        hostedInvoiceUrl: 'https://invoice.stripe.test/in_3',
      }),
    ).toEqual({
      messageKey: 'change_plan_pending',
      tone: 'info',
      hostedInvoiceUrl: 'https://invoice.stripe.test/in_3',
    });
  });
});

describe('invoiceHistoryPath', () => {
  it('points students and educators at their payment history', () => {
    expect(invoiceHistoryPath(AccountType.STUDENT)).toBe('/app/account/payments');
    expect(invoiceHistoryPath(AccountType.EDUCATOR)).toBe('/edu/account/payments');
    expect(invoiceHistoryPath(AccountType.MANAGER)).toBeNull();
  });
});

describe('billingScopeUrl', () => {
  it('asks for the caller’s own row on a personal surface only', () => {
    expect(billingScopeUrl('/api/v1/billing/subscription', true)).toBe(
      '/api/v1/billing/subscription?scope=personal',
    );
    expect(billingScopeUrl('/api/v1/billing/subscription', false)).toBe(
      '/api/v1/billing/subscription',
    );
  });

  it('appends to an existing query string', () => {
    expect(billingScopeUrl('/api/v1/stripe/portal?locale=pl', true)).toBe(
      '/api/v1/stripe/portal?locale=pl&scope=personal',
    );
  });
});

describe('billingCardRequest', () => {
  it('names the personal scope on every provider action', () => {
    // Portal and release read like the billing read: the scope is in the URL.
    expect(billingCardRequest({ type: 'portal', locale: 'pl' }, true)).toEqual({
      method: 'GET',
      url: '/api/v1/stripe/portal?locale=pl&scope=personal',
    });
    expect(billingCardRequest({ type: 'release' }, true)).toEqual({
      method: 'POST',
      url: '/api/v1/billing/release-scheduled-plan?scope=personal',
      body: {},
    });
    // Change, preview and cancel write it into the JSON body.
    expect(billingCardRequest({ type: 'change', planKey: 'pro' }, true)).toEqual({
      method: 'POST',
      url: '/api/v1/billing/change-plan',
      body: { planKey: 'pro', scope: 'personal' },
    });
    expect(billingCardRequest({ type: 'preview', planKey: 'pro' }, true)).toEqual({
      method: 'POST',
      url: '/api/v1/billing/change-plan/preview',
      body: { planKey: 'pro', scope: 'personal' },
    });
    expect(billingCardRequest({ type: 'cancel', cancel: true }, true)).toEqual({
      method: 'POST',
      url: '/api/v1/billing/cancel',
      body: { cancel: true, scope: 'personal' },
    });
  });

  it('keeps every action org-first off a personal surface', () => {
    expect(billingCardRequest({ type: 'portal', locale: 'pl' }, false)).toEqual({
      method: 'GET',
      url: '/api/v1/stripe/portal?locale=pl',
    });
    expect(billingCardRequest({ type: 'release' }, false)).toEqual({
      method: 'POST',
      url: '/api/v1/billing/release-scheduled-plan',
      body: {},
    });
    expect(billingCardRequest({ type: 'change', planKey: 'pro' }, false)).toEqual({
      method: 'POST',
      url: '/api/v1/billing/change-plan',
      body: { planKey: 'pro' },
    });
    expect(billingCardRequest({ type: 'preview', planKey: 'ace' }, false)).toEqual({
      method: 'POST',
      url: '/api/v1/billing/change-plan/preview',
      body: { planKey: 'ace' },
    });
    expect(billingCardRequest({ type: 'cancel', cancel: false }, false)).toEqual({
      method: 'POST',
      url: '/api/v1/billing/cancel',
      body: { cancel: false },
    });
  });
});

describe('previewPlanChange', () => {
  it('requests the read-only preview for a plan click, never the confirmed change', async () => {
    const preview: ChangePlanPreview = {
      direction: 'upgrade',
      currentPlanKey: 'spark',
      targetPlanKey: 'ace',
      amountDue: 3999,
      currency: 'PLN',
      effectiveAt: '2026-11-26T00:00:00.000Z',
      resumesAtPeriodEnd: false,
      replacesPendingPlanKey: null,
      blockedBySchedule: false,
    };
    const calls: Array<{ url: string; body: unknown }> = [];
    const post = (url: string, body: unknown): Promise<ChangePlanPreview> => {
      calls.push({ url, body });
      return Promise.resolve(preview);
    };

    const result = await previewPlanChange('ace', true, post);

    expect(result).toEqual(preview);
    expect(calls).toEqual([
      {
        url: '/api/v1/billing/change-plan/preview',
        body: { planKey: 'ace', scope: 'personal' },
      },
    ]);
    expect(calls.some((call) => call.url === '/api/v1/billing/change-plan')).toBe(false);
  });
});

describe('cancellation state', () => {
  it('shows the scheduled cancellation from the endpoint result before the refetch', () => {
    const view = withCancellationOverride(subscription({ cancelAtPeriodEnd: false }), true);

    expect(scheduledCancellationDate(view)).toBe('2026-12-01T00:00:00.000Z');
    expect(periodRow(view)).toBeNull();
  });

  it('submits the cancellation, applies the returned flag, then re-reads', async () => {
    const calls: string[] = [];
    const post = (url: string, body: unknown): Promise<{ cancelAtPeriodEnd: boolean }> => {
      calls.push(`post:${url}:${JSON.stringify(body)}`);
      return Promise.resolve({ cancelAtPeriodEnd: true });
    };

    const result = await submitCancellation({
      cancel: true,
      personal: true,
      post,
      effects: {
        onCancelAtPeriodEnd: (value) => calls.push(`override:${value}`),
        onChanged: () => calls.push('changed'),
        scheduleRefresh: () => calls.push('refresh'),
      },
    });

    expect(result).toEqual({ cancelAtPeriodEnd: true });
    expect(calls).toEqual([
      'post:/api/v1/billing/cancel:{"cancel":true,"scope":"personal"}',
      'override:true',
      'changed',
      'refresh',
    ]);
  });
});

describe('withPersonalScope', () => {
  it('adds the personal scope to a billing action body', () => {
    expect(withPersonalScope({ planKey: 'pro' }, true)).toEqual({
      planKey: 'pro',
      scope: 'personal',
    });
    expect(withPersonalScope({ cancel: true }, true)).toEqual({ cancel: true, scope: 'personal' });
  });

  it('leaves the body untouched off a personal surface', () => {
    expect(withPersonalScope({ planKey: 'pro' }, false)).toEqual({ planKey: 'pro' });
  });
});
