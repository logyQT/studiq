import { AccountType } from '@studiq/authz';
import type { BillingSubscriptionView } from '@studiq/server/services/billing.service';
import type { PlanInfo } from '@studiq/server/services/subscription-plan.service';
import {
  alternativePlans,
  billingPlanFamily,
  billingStatusKey,
  hasProviderActions,
  invoiceHistoryPath,
  invoiceHref,
  noActionsMessageKey,
  periodRow,
  planChangeFeedback,
  seatsSummary,
} from '@/lib/billing-subscription';
import { describe, expect, it } from 'vitest';

function subscription(overrides: Partial<BillingSubscriptionView> = {}): BillingSubscriptionView {
  return {
    provider: 'stripe',
    planKey: 'spark',
    planName: 'StudiQ Spark',
    billedPlanKey: 'spark',
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
    forAccountType: 'student',
    ...overrides,
  };
}

describe('billingPlanFamily', () => {
  it('maps the three account types and defaults to student', () => {
    expect(billingPlanFamily(AccountType.MANAGER)).toBe('manager');
    expect(billingPlanFamily(AccountType.EDUCATOR)).toBe('educator');
    expect(billingPlanFamily(AccountType.STUDENT)).toBe('student');
  });
});

describe('alternativePlans', () => {
  it('keeps paid plans of the same family, excluding the current plan', () => {
    const options = alternativePlans(
      [
        plan('base', { priceMonthly: 0 }),
        plan('ace', { priceMonthly: 2999 }),
        plan('pro', { priceMonthly: 4999 }),
        plan('lite', { priceMonthly: 1999, forAccountType: 'educator' }),
        plan('spark', { priceMonthly: 999 }),
      ],
      subscription(),
      AccountType.STUDENT,
    );

    expect(options.map((option) => option.key)).toEqual(['ace', 'pro']);
  });

  it('excludes the billed plan even when the effective plan is a seat plan', () => {
    const options = alternativePlans(
      [plan('spark', { priceMonthly: 999 }), plan('pro', { priceMonthly: 4999 })],
      subscription({ planKey: 'ace', planName: 'StudiQ Ace', billedPlanKey: 'spark' }),
      AccountType.STUDENT,
    );

    expect(options.map((option) => option.key)).toEqual(['pro']);
  });

  it('returns an empty list without a catalogue', () => {
    expect(alternativePlans(undefined, subscription(), AccountType.STUDENT)).toEqual([]);
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

  it('uses the cancellation message when cancellation is scheduled', () => {
    expect(periodRow(subscription({ cancelAtPeriodEnd: true }))).toMatchObject({
      messageKey: 'cancels_on',
    });
  });

  it('hides the row without a period or for a canceled subscription', () => {
    expect(periodRow(subscription({ currentPeriodEnd: null }))).toBeNull();
    expect(periodRow(subscription({ status: 'canceled' }))).toBeNull();
    expect(periodRow(subscription({ status: 'incomplete_expired' }))).toBeNull();
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

  it('does not surface an empty invoice URL', () => {
    expect(planChangeFeedback({ status: 'pending_payment', hostedInvoiceUrl: null })).toMatchObject(
      { hostedInvoiceUrl: null },
    );
  });
});

describe('invoiceHistoryPath', () => {
  it('points students and educators at their payment history', () => {
    expect(invoiceHistoryPath(AccountType.STUDENT)).toBe('/app/account/payments');
    expect(invoiceHistoryPath(AccountType.EDUCATOR)).toBe('/edu/account/payments');
    expect(invoiceHistoryPath(AccountType.MANAGER)).toBeNull();
  });
});
