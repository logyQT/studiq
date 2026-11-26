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

const LADDER: Array<Pick<PlanInfo, 'key' | 'name' | 'priceMonthly'>> = [
  { key: 'base', name: 'StudiQ Free', priceMonthly: 0 },
  { key: 'spark', name: 'StudiQ Plus', priceMonthly: 1999 },
  { key: 'ace', name: 'StudiQ Pro', priceMonthly: 3999 },
  { key: 'pro', name: 'StudiQ Max', priceMonthly: 7999 },
];

interface CardOptions {
  planKey?: string;
  isCurrentPlan?: boolean;
  signedIn?: boolean;
  hasActivePlan: boolean | null;
}

function cardElement({
  planKey = 'ace',
  isCurrentPlan = false,
  signedIn = true,
  hasActivePlan,
}: CardOptions) {
  const fixture = LADDER.find((candidate) => candidate.key === planKey) ?? LADDER[2];
  return createElement(PlanCard, {
    plan: plan(fixture),
    isCurrentPlan,
    user: signedIn ? { id: 'u-1' } : null,
    t,
    hasActivePlan,
    billingHref: '/app/billing',
  });
}

function render(options: CardOptions): string {
  return renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale, messages: pl, timeZone: 'UTC' },
      cardElement(options),
    ),
  );
}

/** The class list of every action element the markup renders: a link or a button. */
function actionClasses(markup: string): string[] {
  return [...markup.matchAll(/<(?:a|button)\b[^>]*\bclass="([^"]*)"/g)].map((match) => match[1]);
}

function toneTokens(classes: string): string[] {
  return classes.split(/\s+/);
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
    const classes = actionClasses(markup);

    expect(markup.split(t('current_plan_badge')).length - 1).toBe(1);
    expect(markup.match(/<button[^>]*disabled[^>]*>([^<]*)<\/button>/)?.[1]).toBe(t('cta_current'));
    expect(markup).not.toContain('href="/app/billing"');
    expect(markup).not.toContain(t('cta_ace'));
    // A disabled control answers no pointer, so the quiet tone's hover fill has no
    // element to tint.
    expect(classes).toHaveLength(1);
    expect(toneTokens(classes[0])).toContain('disabled:pointer-events-none');
  });

  it('starts a checkout for a signed-in reader without a subscription', () => {
    const markup = render({ hasActivePlan: false });

    expect(markup).toContain(t('cta_ace'));
    expect(markup).toMatch(/<button[^>]*/);
    expect(markup).not.toContain('href="/app/billing"');
  });

  it('prints no action while the plan read is pending or failed', () => {
    const markup = render({ hasActivePlan: null });

    expect(markup).toContain('StudiQ Pro');
    expect(markup).not.toContain('href="/app/billing"');
    expect(markup).not.toContain(t('cta_ace'));
    expect(markup).not.toMatch(/<button[^>]*/);
  });

  it('keeps the free plan link to the app for a signed-in reader', () => {
    const markup = render({ planKey: 'base', hasActivePlan: false });

    expect(markup).toContain('href="/app"');
    expect(markup).not.toContain('href="/app/billing"');
  });

  it('gives the recommended paid card the single signal fill', () => {
    const classes = actionClasses(render({ planKey: 'ace', hasActivePlan: false }));

    expect(classes).toHaveLength(1);
    expect(toneTokens(classes[0])).toContain('bg-signal');
    expect(classes[0]).toContain('rounded-control');
    expect(classes[0]).toContain('h-11');
  });

  it('keeps every other paid card quiet', () => {
    const classes = actionClasses(render({ planKey: 'spark', hasActivePlan: false }));

    expect(classes).toHaveLength(1);
    expect(toneTokens(classes[0])).toContain('border-input');
    expect(toneTokens(classes[0])).not.toContain('bg-signal');
  });

  it('keeps the current plan disabled and quiet even when the ladder recommends it', () => {
    const markup = render({ planKey: 'ace', isCurrentPlan: true, hasActivePlan: true });
    const classes = actionClasses(markup);

    expect(classes).toHaveLength(1);
    expect(toneTokens(classes[0])).toContain('border-input');
    expect(toneTokens(classes[0])).not.toContain('bg-signal');
    expect(markup).toMatch(/<button[^>]*\bdisabled\b/);
  });

  it('gives the recommended plan the signal fill for a signed-out reader', () => {
    const classes = actionClasses(render({ planKey: 'ace', signedIn: false, hasActivePlan: null }));

    expect(classes).toHaveLength(1);
    expect(toneTokens(classes[0])).toContain('bg-signal');
    expect(classes[0]).toContain('rounded-control');
  });

  it('shares one control class and one signal fill across the whole grid', () => {
    const markup = renderToStaticMarkup(
      createElement(
        NextIntlClientProvider,
        { locale, messages: pl, timeZone: 'UTC' },
        createElement(
          'div',
          null,
          ...LADDER.map((fixture) =>
            createElement(PlanCard, {
              key: fixture.key,
              plan: plan(fixture),
              isCurrentPlan: fixture.key === 'base',
              user: { id: 'u-1' },
              t,
              hasActivePlan: false,
              billingHref: '/app/billing',
            }),
          ),
        ),
      ),
    );
    const classes = actionClasses(markup);

    expect(classes).toHaveLength(LADDER.length);
    for (const action of classes) {
      expect(action).toContain('rounded-control');
      expect(action).toContain('h-11');
    }
    const signalActions = classes.filter((action) => toneTokens(action).includes('bg-signal'));
    expect(signalActions).toHaveLength(1);
  });
});

describe('PlanCard badges', () => {
  it('prints the current badge and not the recommended badge on a current recommended plan', () => {
    const markup = render({ planKey: 'ace', isCurrentPlan: true, hasActivePlan: true });

    expect(markup).toContain(t('current_plan_badge'));
    expect(markup).not.toContain(t('recommended_badge'));
  });

  it('prints the recommended badge on a recommended plan the reader does not own', () => {
    const markup = render({ planKey: 'ace', hasActivePlan: true });

    expect(markup).toContain(t('recommended_badge'));
    expect(markup).not.toContain(t('current_plan_badge'));
  });
});
