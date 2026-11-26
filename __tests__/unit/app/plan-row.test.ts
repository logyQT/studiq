import type { PlanInfo } from '@studiq/server/services/subscription-plan.service';
import { createTranslator, NextIntlClientProvider } from 'next-intl';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PlanRow } from '@/app/(frontend)/pricing/_components/plan-row';
import pl from '@/i18n/messages/pl.json';

const locale = 'pl';
const t = createTranslator({ locale, messages: pl, namespace: 'PricingPage' });

function plan(overrides: Partial<PlanInfo> = {}): PlanInfo {
  return {
    id: 'plan-spark',
    key: 'spark',
    name: 'StudiQ Plus',
    description: null,
    priceMonthly: 1999,
    priceYearly: 19990,
    currency: 'PLN',
    features: [],
    limits: {},
    sortOrder: 2,
    isActive: true,
    scope: 'personal',
    audience: null,
    seatEligible: false,
    ...overrides,
  };
}

function render({
  isCurrent = false,
  hasActivePlan,
}: {
  isCurrent?: boolean;
  hasActivePlan: boolean | null;
}): string {
  return renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale, messages: pl, timeZone: 'UTC' },
      createElement(PlanRow, {
        plan: plan(),
        isCurrent,
        signedIn: true,
        hasActivePlan,
        billingHref: '/app/billing',
      }),
    ),
  );
}

describe('PlanRow action', () => {
  it('prints a disabled current-plan action and no checkout on the plan the reader owns', () => {
    const markup = render({ isCurrent: true, hasActivePlan: true });

    // The badge names the plan's state; the button names the action, so the two
    // no longer carry the same phrase.
    expect(markup.split(t('current_plan_badge')).length - 1).toBe(1);
    expect(markup.match(/<button[^>]*disabled[^>]*>([^<]*)<\/button>/)?.[1]).toBe(t('cta_current'));
    expect(markup).not.toContain(t('cta_spark'));
    expect(markup).not.toContain('href="/app/billing"');
  });

  it('sends an existing subscriber to the billing change-plan page', () => {
    const markup = render({ hasActivePlan: true });

    expect(markup).toContain('href="/app/billing"');
    expect(markup).toContain(t('cta_change_plan'));
    expect(markup).not.toContain(t('cta_spark'));
    expect(markup).not.toContain(t('cta_current'));
  });
});
