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
    id: 'plan-pro',
    key: 'pro',
    name: 'StudiQ Pro',
    description: null,
    priceMonthly: 4999,
    priceYearly: 49990,
    currency: 'PLN',
    features: ['flashcards'],
    limits: {},
    sortOrder: 1,
    isActive: true,
    scope: 'personal',
    seatEligible: false,
    ...overrides,
  };
}

const LADDER: Array<Pick<PlanInfo, 'key' | 'name' | 'priceMonthly'>> = [
  { key: 'free', name: 'StudiQ Free', priceMonthly: 0 },
  { key: 'plus', name: 'StudiQ Plus', priceMonthly: 1999 },
  { key: 'pro', name: 'StudiQ Pro', priceMonthly: 3999 },
  { key: 'max', name: 'StudiQ Max', priceMonthly: 7999 },
];

/** The organization grid: a free tier, the recommended Hub and sales-led Campus. */
const ORGANIZATION_LADDER: Array<Pick<PlanInfo, 'key' | 'name' | 'priceMonthly'>> = [
  { key: 'launch', name: 'StudiQ Launch', priceMonthly: 0 },
  { key: 'hub', name: 'StudiQ Hub', priceMonthly: 29900 },
  { key: 'campus', name: 'StudiQ Campus', priceMonthly: 69900 },
];

const ALL_PLANS = [...LADDER, ...ORGANIZATION_LADDER];

interface CardOptions {
  planKey?: string;
  isCurrentPlan?: boolean;
  signedIn?: boolean;
  hasActivePlan: boolean | null;
}

function cardElement({
  planKey = 'pro',
  isCurrentPlan = false,
  signedIn = true,
  hasActivePlan,
}: CardOptions) {
  const fixture = ALL_PLANS.find((candidate) => candidate.key === planKey) ?? LADDER[2];
  return createElement(PlanCard, {
    plan: plan(fixture),
    isCurrentPlan,
    user: signedIn ? { id: 'u-1' } : null,
    t,
    hasActivePlan,
    billingHref: '/app/billing',
  });
}

function gridMarkup(
  ladder: Array<Pick<PlanInfo, 'key' | 'name' | 'priceMonthly'>>,
  {
    isCurrentKey,
    hasActivePlan = false,
  }: { isCurrentKey?: string; hasActivePlan?: boolean | null } = {},
): string {
  return renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale, messages: pl, timeZone: 'UTC' },
      createElement(
        'div',
        null,
        ...ladder.map((fixture) =>
          createElement(PlanCard, {
            key: fixture.key,
            plan: plan(fixture),
            isCurrentPlan: fixture.key === isCurrentKey,
            user: { id: 'u-1' },
            t,
            hasActivePlan,
            billingHref: '/app/billing',
          }),
        ),
      ),
    ),
  );
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

/** `href` → class list for every link the markup renders. */
function linkClasses(markup: string): Map<string, string> {
  return new Map(
    [...markup.matchAll(/<a\b([^>]*)>/g)].map((match) => [
      /\bhref="([^"]*)"/.exec(match[1])?.[1] ?? '',
      /\bclass="([^"]*)"/.exec(match[1])?.[1] ?? '',
    ]),
  );
}

describe('PlanCard action', () => {
  it('sends an existing subscriber to the billing change-plan page', () => {
    const markup = render({ hasActivePlan: true });

    expect(markup).toContain('href="/app/billing"');
    expect(markup).toContain(t('cta_change_plan'));
    expect(markup).not.toContain(t('cta_pro'));
  });

  it('prints a disabled current-plan action on the plan the reader owns', () => {
    const markup = render({ isCurrentPlan: true, hasActivePlan: true });
    const classes = actionClasses(markup);

    expect(markup.split(t('current_plan_badge')).length - 1).toBe(1);
    expect(markup.match(/<button[^>]*disabled[^>]*>([^<]*)<\/button>/)?.[1]).toBe(t('cta_current'));
    expect(markup).not.toContain('href="/app/billing"');
    expect(markup).not.toContain(t('cta_pro'));
    // A disabled control answers no pointer, so the quiet tone's hover fill has no
    // element to tint.
    expect(classes).toHaveLength(1);
    expect(toneTokens(classes[0])).toContain('disabled:pointer-events-none');
  });

  it('starts a checkout for a signed-in reader without a subscription', () => {
    const markup = render({ hasActivePlan: false });

    expect(markup).toContain(t('cta_pro'));
    expect(markup).toMatch(/<button[^>]*/);
    expect(markup).not.toContain('href="/app/billing"');
  });

  it('prints no action while the plan read is pending or failed', () => {
    const markup = render({ hasActivePlan: null });

    expect(markup).toContain('StudiQ Pro');
    expect(markup).not.toContain('href="/app/billing"');
    expect(markup).not.toContain(t('cta_pro'));
    expect(markup).not.toMatch(/<button[^>]*/);
  });

  it('keeps the free plan link to the app for a signed-in reader', () => {
    const markup = render({ planKey: 'free', hasActivePlan: false });

    expect(markup).toContain('href="/app"');
    expect(markup).not.toContain('href="/app/billing"');
  });

  it('sends the subscriber’s free card to the billing downgrade', () => {
    // The free card is a downgrade for a subscriber, so it goes to the billing
    // page rather than back into the app (#1523).
    const markup = render({ planKey: 'free', hasActivePlan: true });

    expect(markup).toContain('href="/app/billing"');
    expect(markup).toContain(t('cta_change_plan'));
    expect(markup).not.toMatch(/href="\/app"/);
  });

  it('keeps the free plan the reader owns disabled and current', () => {
    const markup = render({ planKey: 'free', isCurrentPlan: true, hasActivePlan: true });

    expect(markup.match(/<button[^>]*disabled[^>]*>([^<]*)<\/button>/)?.[1]).toBe(t('cta_current'));
    expect(markup).not.toMatch(/href="\/app/);
  });

  it('keeps the Campus contact action quiet and Hub the grid’s only signal', () => {
    const markup = gridMarkup(ORGANIZATION_LADDER);
    const links = linkClasses(markup);
    const contact = links.get('/contact');

    // The sales link keeps the quiet fill; only the recommended Hub is signal.
    expect(contact).toBeDefined();
    expect(toneTokens(contact ?? '')).toContain('border-input');
    expect(toneTokens(contact ?? '')).not.toContain('bg-signal');

    const classes = actionClasses(markup);
    expect(classes.filter((action) => toneTokens(action).includes('bg-signal'))).toHaveLength(1);
    expect([...links.values()].filter((c) => toneTokens(c).includes('bg-signal'))).toHaveLength(0);
  });

  it('gives the recommended paid card the single signal fill', () => {
    const classes = actionClasses(render({ planKey: 'pro', hasActivePlan: false }));

    expect(classes).toHaveLength(1);
    expect(toneTokens(classes[0])).toContain('bg-signal');
    expect(classes[0]).toContain('rounded-control');
    expect(classes[0]).toContain('h-11');
  });

  it('keeps every other paid card quiet', () => {
    const classes = actionClasses(render({ planKey: 'plus', hasActivePlan: false }));

    expect(classes).toHaveLength(1);
    expect(toneTokens(classes[0])).toContain('border-input');
    expect(toneTokens(classes[0])).not.toContain('bg-signal');
  });

  it('keeps the current plan disabled and quiet even when the ladder recommends it', () => {
    const markup = render({ planKey: 'pro', isCurrentPlan: true, hasActivePlan: true });
    const classes = actionClasses(markup);

    expect(classes).toHaveLength(1);
    expect(toneTokens(classes[0])).toContain('border-input');
    expect(toneTokens(classes[0])).not.toContain('bg-signal');
    expect(markup).toMatch(/<button[^>]*\bdisabled\b/);
  });

  it('gives the recommended plan the signal fill for a signed-out reader', () => {
    const classes = actionClasses(render({ planKey: 'pro', signedIn: false, hasActivePlan: null }));

    expect(classes).toHaveLength(1);
    expect(toneTokens(classes[0])).toContain('bg-signal');
    expect(classes[0]).toContain('rounded-control');
  });

  it('shares one control class and one signal fill across the whole grid', () => {
    const classes = actionClasses(gridMarkup(LADDER, { isCurrentKey: 'free' }));

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
    const markup = render({ planKey: 'pro', isCurrentPlan: true, hasActivePlan: true });

    expect(markup).toContain(t('current_plan_badge'));
    expect(markup).not.toContain(t('recommended_badge'));
  });

  it('prints the recommended badge on a recommended plan the reader does not own', () => {
    const markup = render({ planKey: 'pro', hasActivePlan: true });

    expect(markup).toContain(t('recommended_badge'));
    expect(markup).not.toContain(t('current_plan_badge'));
  });
});
