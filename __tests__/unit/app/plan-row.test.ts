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
    id: 'plan-plus',
    key: 'plus',
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
    seatEligible: false,
    ...overrides,
  };
}

const LADDER = [
  { key: 'free', name: 'StudiQ Free', priceMonthly: 0 },
  { key: 'plus', name: 'StudiQ Plus', priceMonthly: 1999 },
  { key: 'pro', name: 'StudiQ Pro', priceMonthly: 3999 },
  { key: 'max', name: 'StudiQ Max', priceMonthly: 7999 },
];

/** The organization ladder: a free tier, Team, the recommended Hub and Campus. */
const ORGANIZATION_LADDER = [
  {
    key: 'launch',
    name: 'StudiQ Launch',
    priceMonthly: 0,
    scope: 'organization' as const,
    features: ['flashcards', 'quiz'],
    limits: { max_students: 5, max_groups: 3 },
  },
  {
    key: 'team',
    name: 'StudiQ Team',
    priceMonthly: 9900,
    scope: 'organization' as const,
    features: ['flashcards', 'quiz', 'quiz.templates'],
    limits: { max_students: 25, max_groups: 10 },
  },
  {
    key: 'hub',
    name: 'StudiQ Hub',
    priceMonthly: 29900,
    scope: 'organization' as const,
    features: ['flashcards', 'quiz', 'quiz.templates', 'stats.insights'],
    limits: { max_students: 100, max_groups: 40 },
  },
  {
    key: 'campus',
    name: 'StudiQ Campus',
    priceMonthly: 69900,
    scope: 'organization' as const,
    features: ['branding', 'flashcards', 'quiz', 'quiz.templates', 'stats.insights'],
    limits: { max_students: 1000, max_groups: 100 },
  },
];

type PlanFixture = Pick<PlanInfo, 'key' | 'name' | 'priceMonthly'> &
  Partial<Pick<PlanInfo, 'scope' | 'features' | 'limits'>>;

const ALL_PLANS: PlanFixture[] = [...LADDER, ...ORGANIZATION_LADDER];

interface RowOptions {
  planKey?: string;
  isCurrent?: boolean;
  signedIn?: boolean;
  hasActivePlan: boolean | null;
}

function rowElement({
  planKey = 'plus',
  isCurrent = false,
  signedIn = true,
  hasActivePlan,
}: RowOptions) {
  const fixture = ALL_PLANS.find((candidate) => candidate.key === planKey);
  return createElement(PlanRow, {
    plan: fixture ? plan(fixture) : plan(),
    isCurrent,
    signedIn,
    hasActivePlan,
    billingHref: '/app/billing',
  });
}

function ladderMarkup(
  ladder: PlanFixture[],
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
        'ul',
        null,
        ...ladder.map((fixture) =>
          createElement(PlanRow, {
            key: fixture.key,
            plan: plan(fixture),
            isCurrent: fixture.key === isCurrentKey,
            signedIn: true,
            hasActivePlan,
            billingHref: '/app/billing',
          }),
        ),
      ),
    ),
  );
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

/** `href` → class list for every link the markup renders. */
function linkClasses(markup: string): Map<string, string> {
  return new Map(
    [...markup.matchAll(/<a\b([^>]*)>/g)].map((match) => [
      /\bhref="([^"]*)"/.exec(match[1])?.[1] ?? '',
      /\bclass="([^"]*)"/.exec(match[1])?.[1] ?? '',
    ]),
  );
}

describe('PlanRow action', () => {
  it('prints a disabled current-plan action and no checkout on the plan the reader owns', () => {
    const markup = render({ isCurrent: true, hasActivePlan: true });
    const classes = actionClasses(markup);

    // The badge names the plan's state; the button names the action, so the two
    // no longer carry the same phrase.
    expect(markup.split(t('current_plan_badge')).length - 1).toBe(1);
    expect(markup.match(/<button[^>]*disabled[^>]*>([^<]*)<\/button>/)?.[1]).toBe(t('cta_current'));
    expect(markup).not.toContain(t('cta_plus'));
    expect(markup).not.toContain('href="/app/billing"');
    // A disabled control answers no pointer, so the quiet tone's hover fill has no
    // element to tint.
    expect(classes).toHaveLength(1);
    expect(toneTokens(classes[0])).toContain('disabled:pointer-events-none');
  });

  it('sends an existing subscriber to the billing change-plan page', () => {
    const markup = render({ hasActivePlan: true });

    expect(markup).toContain('href="/app/billing"');
    expect(markup).toContain(t('cta_change_plan'));
    expect(markup).not.toContain(t('cta_plus'));
    expect(markup).not.toContain(t('cta_current'));
  });

  it('gives the recommended paid plan the single signal fill', () => {
    const classes = actionClasses(render({ planKey: 'pro', hasActivePlan: false }));

    expect(classes).toHaveLength(1);
    expect(toneTokens(classes[0])).toContain('bg-signal');
    expect(classes[0]).toContain('rounded-control');
    expect(classes[0]).toContain('h-11');
  });

  it('keeps every other paid plan quiet', () => {
    const classes = actionClasses(render({ planKey: 'plus', hasActivePlan: false }));

    expect(classes).toHaveLength(1);
    expect(toneTokens(classes[0])).toContain('border-input');
    expect(toneTokens(classes[0])).not.toContain('bg-signal');
    expect(classes[0]).toContain('rounded-control');
    expect(classes[0]).toContain('h-11');
  });

  it('keeps the current plan disabled and quiet even when the ladder recommends it', () => {
    const markup = render({ planKey: 'pro', isCurrent: true, hasActivePlan: true });
    const classes = actionClasses(markup);

    expect(classes).toHaveLength(1);
    expect(toneTokens(classes[0])).toContain('border-input');
    expect(toneTokens(classes[0])).not.toContain('bg-signal');
    expect(markup).toMatch(/<button[^>]*\bdisabled\b/);
  });

  it('keeps the free register action quiet for a signed-out reader', () => {
    const classes = actionClasses(
      render({ planKey: 'free', signedIn: false, hasActivePlan: null }),
    );

    expect(classes).toHaveLength(1);
    expect(toneTokens(classes[0])).toContain('border-input');
    expect(toneTokens(classes[0])).not.toContain('bg-signal');
  });

  it('sends the subscriber’s free row to the billing downgrade', () => {
    const markup = render({ planKey: 'free', hasActivePlan: true });

    expect(markup).toContain('href="/app/billing"');
    expect(markup).toContain(t('cta_change_plan'));
  });

  it('keeps every organization row a checkout and Hub the ladder’s only signal', () => {
    const markup = ladderMarkup(ORGANIZATION_LADDER);
    const links = linkClasses(markup);

    // Campus is purchasable: no plan row is a conversation any more, and the
    // custom-setup CTA is a separate band, not a row action.
    expect(links.get('/contact')).toBeUndefined();
    expect(markup).toContain(t('cta_team'));
    expect(markup).toContain(t('cta_campus'));

    // The one signal is Hub's checkout button; no link carries the fill.
    const classes = actionClasses(markup);
    const signals = classes.filter((action) => toneTokens(action).includes('bg-signal'));
    expect(signals).toHaveLength(1);
    expect([...links.values()].filter((c) => toneTokens(c).includes('bg-signal'))).toHaveLength(0);
  });

  it('sends an organization subscriber to the billing change-plan page', () => {
    const markup = ladderMarkup(ORGANIZATION_LADDER, { hasActivePlan: true });

    expect(linkClasses(markup).get('/app/billing')).toBeDefined();
    expect(markup).not.toContain(t('cta_campus'));
  });

  it('prints the organization capacity on its row only', () => {
    const org = ladderMarkup(ORGANIZATION_LADDER);
    expect(org).toContain('do 25 uczniów');
    expect(org).toContain('do 10 grup');

    // A personal row never prints seats, even if the plan carries a stray row.
    const personal = renderToStaticMarkup(
      createElement(
        NextIntlClientProvider,
        { locale, messages: pl, timeZone: 'UTC' },
        createElement(PlanRow, {
          plan: plan({ limits: { max_students: 5, max_groups: 3 } }),
          isCurrent: false,
          signedIn: true,
          hasActivePlan: false,
          billingHref: '/app/billing',
        }),
      ),
    );
    expect(personal).not.toContain('uczniów');
    expect(personal).not.toContain('grup');
  });

  it('shares one control class and one signal fill across the whole ladder', () => {
    const classes = actionClasses(ladderMarkup(LADDER, { isCurrentKey: 'free' }));

    expect(classes).toHaveLength(LADDER.length);
    for (const action of classes) {
      expect(action).toContain('rounded-control');
      expect(action).toContain('h-11');
    }
    const signalActions = classes.filter((action) => toneTokens(action).includes('bg-signal'));
    expect(signalActions).toHaveLength(1);
  });
});
