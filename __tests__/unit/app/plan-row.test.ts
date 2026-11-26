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

const LADDER: Array<Pick<PlanInfo, 'key' | 'name' | 'priceMonthly'>> = [
  { key: 'base', name: 'StudiQ Free', priceMonthly: 0 },
  { key: 'spark', name: 'StudiQ Plus', priceMonthly: 1999 },
  { key: 'ace', name: 'StudiQ Pro', priceMonthly: 3999 },
  { key: 'pro', name: 'StudiQ Max', priceMonthly: 7999 },
];

interface RowOptions {
  planKey?: string;
  isCurrent?: boolean;
  signedIn?: boolean;
  hasActivePlan: boolean | null;
}

function rowElement({
  planKey = 'spark',
  isCurrent = false,
  signedIn = true,
  hasActivePlan,
}: RowOptions) {
  const fixture = LADDER.find((candidate) => candidate.key === planKey);
  return createElement(PlanRow, {
    plan: fixture ? plan(fixture) : plan(),
    isCurrent,
    signedIn,
    hasActivePlan,
    billingHref: '/app/billing',
  });
}

function render(options: RowOptions): string {
  return renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale, messages: pl, timeZone: 'UTC' },
      rowElement(options),
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

  it('gives the recommended paid plan the single signal fill', () => {
    const classes = actionClasses(render({ planKey: 'ace', hasActivePlan: false }));

    expect(classes).toHaveLength(1);
    expect(toneTokens(classes[0])).toContain('bg-signal');
    expect(classes[0]).toContain('rounded-control');
    expect(classes[0]).toContain('h-11');
  });

  it('keeps every other paid plan quiet', () => {
    const classes = actionClasses(render({ planKey: 'spark', hasActivePlan: false }));

    expect(classes).toHaveLength(1);
    expect(toneTokens(classes[0])).toContain('border-input');
    expect(toneTokens(classes[0])).not.toContain('bg-signal');
    expect(classes[0]).toContain('rounded-control');
    expect(classes[0]).toContain('h-11');
  });

  it('keeps the current plan disabled and quiet even when the ladder recommends it', () => {
    const markup = render({ planKey: 'ace', isCurrent: true, hasActivePlan: true });
    const classes = actionClasses(markup);

    expect(classes).toHaveLength(1);
    expect(toneTokens(classes[0])).toContain('border-input');
    expect(toneTokens(classes[0])).not.toContain('bg-signal');
    expect(markup).toMatch(/<button[^>]*\bdisabled\b/);
  });

  it('keeps the free register action quiet for a signed-out reader', () => {
    const classes = actionClasses(
      render({ planKey: 'base', signedIn: false, hasActivePlan: null }),
    );

    expect(classes).toHaveLength(1);
    expect(toneTokens(classes[0])).toContain('border-input');
    expect(toneTokens(classes[0])).not.toContain('bg-signal');
  });

  it('shares one control class and one signal fill across the whole ladder', () => {
    const markup = renderToStaticMarkup(
      createElement(
        NextIntlClientProvider,
        { locale, messages: pl, timeZone: 'UTC' },
        createElement(
          'ul',
          null,
          ...LADDER.map((fixture) =>
            createElement(PlanRow, {
              key: fixture.key,
              plan: plan(fixture),
              isCurrent: fixture.key === 'base',
              signedIn: true,
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
