import type { PlanInfo } from '@studiq/server/services/subscription-plan.service';
import { createTranslator, NextIntlClientProvider } from 'next-intl';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PlanCard } from '@/components/pricing/plan-card';
import pl from '@/i18n/messages/pl.json';

const locale = 'pl';
const t = createTranslator({ locale, messages: pl, namespace: 'PricingPage' });

function plan(overrides: Partial<PlanInfo> = {}): PlanInfo {
  return {
    id: 'plan-ace',
    key: 'ace',
    name: 'StudiQ Ace',
    description: null,
    priceMonthly: 4999,
    priceYearly: 49990,
    currency: 'PLN',
    features: ['flashcards'],
    limits: {},
    sortOrder: 1,
    isActive: true,
    scope: 'personal',
    audience: null,
    seatEligible: false,
    ...overrides,
  };
}

function render({
  isCurrentPlan = false,
  hasActivePlan,
  paid = true,
}: {
  isCurrentPlan?: boolean;
  hasActivePlan: boolean | null;
  paid?: boolean;
}): string {
  return renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale, messages: pl, timeZone: 'UTC' },
      createElement(PlanCard, {
        plan: plan(paid ? {} : { key: 'base', name: 'StudiQ Base', priceMonthly: 0 }),
        isCurrentPlan,
        user: { id: 'u-1' },
        t,
        hasActivePlan,
        billingHref: '/app/billing',
      }),
    ),
  );
}

describe('PlanCard action', () => {
  it('sends an existing subscriber to the billing change-plan page', () => {
    const markup = render({ hasActivePlan: true });

    expect(markup).toContain('href="/app/billing"');
    expect(markup).toContain(t('cta_change_plan'));
    expect(markup).not.toContain(t('cta_ace'));
  });

  it('prints a disabled current-plan action on the plan the reader owns', () => {
    const markup = render({ isCurrentPlan: true, hasActivePlan: true });

    expect(markup.split(t('current_plan_badge')).length - 1).toBe(1);
    expect(markup.match(/<button[^>]*disabled[^>]*>([^<]*)<\/button>/)?.[1]).toBe(t('cta_current'));
    expect(markup).not.toContain('href="/app/billing"');
    expect(markup).not.toContain(t('cta_ace'));
  });

  it('starts a checkout for a signed-in reader without a subscription', () => {
    const markup = render({ hasActivePlan: false });

    expect(markup).toContain(t('cta_ace'));
    expect(markup).toMatch(/<button[^>]*/);
    expect(markup).not.toContain('href="/app/billing"');
  });

  it('prints no action while the plan read is pending or failed', () => {
    const markup = render({ hasActivePlan: null });

    expect(markup).toContain('StudiQ Ace');
    expect(markup).not.toContain('href="/app/billing"');
    expect(markup).not.toContain(t('cta_ace'));
    expect(markup).not.toMatch(/<button[^>]*/);
  });

  it('keeps the free plan link to the app for a signed-in reader', () => {
    const markup = render({ hasActivePlan: false, paid: false });

    expect(markup).toContain('href="/app"');
    expect(markup).not.toContain('href="/app/billing"');
  });
});
