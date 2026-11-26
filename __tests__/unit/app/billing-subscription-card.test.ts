import { AccountType } from '@studiq/authz';
import type { BillingSubscriptionView } from '@studiq/server/services/billing.service';
import type { PlanInfo } from '@studiq/server/services/subscription-plan.service';
import { NextIntlClientProvider } from 'next-intl';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { BillingSubscriptionCard } from '@/components/billing/BillingSubscriptionCard';
import en from '@/i18n/messages/en.json';

function plan(key: string, name: string, priceMonthly: number): PlanInfo {
  return {
    id: key,
    key,
    name,
    description: null,
    priceMonthly,
    priceYearly: priceMonthly * 10,
    currency: 'PLN',
    features: [],
    limits: {},
    sortOrder: priceMonthly,
    isActive: true,
    scope: 'personal',
    audience: 'student',
    seatEligible: false,
  };
}

const plans = [plan('ace', 'StudiQ Ace', 2999), plan('pro', 'StudiQ Max', 7999)];

function subscription(overrides: Partial<BillingSubscriptionView> = {}): BillingSubscriptionView {
  return {
    provider: 'stripe',
    planKey: 'pro',
    planName: 'StudiQ Max',
    billedPlanKey: 'pro',
    billedPlanName: 'StudiQ Max',
    entitlementAppliedPlanKey: 'pro',
    status: 'active',
    currentPeriodEnd: '2026-12-01T12:00:00.000Z',
    cancelAtPeriodEnd: false,
    pendingPlanKey: null,
    priceMonthly: 7999,
    currency: 'PLN',
    canManagePortal: true,
    canChangePlan: true,
    canCancel: true,
    hostedInvoiceUrl: null,
    ...overrides,
  };
}

function render(value: BillingSubscriptionView): string {
  return renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale: 'en', messages: en, timeZone: 'UTC' },
      createElement(BillingSubscriptionCard, {
        subscription: value,
        plans,
        accountType: AccountType.STUDENT,
        onChanged: () => {},
      }),
    ),
  );
}

describe('BillingSubscriptionCard plan state', () => {
  it('names the current plan from the catalogue', () => {
    const markup = render(subscription());

    expect(markup).toContain(en.BillingPage.current_plan_label);
    expect(markup).toContain('StudiQ Max');
  });

  it('names the catalogue plan even when the mirror has no display name', () => {
    const markup = render(subscription({ billedPlanName: null }));

    expect(markup).toContain('StudiQ Max');
  });

  it('shows the renewal date for a live subscription that continues', () => {
    const markup = render(subscription());

    expect(markup).toContain(en.BillingPage.renews_on.replace('{date}', '12/01/2026'));
    expect(markup).not.toContain('Scheduled cancellation');
  });

  it('shows one explicit scheduled cancellation instead of a renewal', () => {
    const markup = render(
      subscription({
        cancelAtPeriodEnd: true,
        currentPeriodEnd: '2026-12-26T12:00:00.000Z',
      }),
    );

    expect(markup).toContain('Scheduled cancellation on 12/26/2026 — access ends then');
    expect(markup).not.toContain('Renews on');
  });
});
