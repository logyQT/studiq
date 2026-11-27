import type { PlanInfo } from '@studiq/server/services/subscription-plan.service';
import { NextIntlClientProvider } from 'next-intl';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PricingPageClient } from '@/app/(frontend)/pricing/_components/pricing-page-client';
import { UpgradePlans } from '@/components/billing/upgrade-plans';
import { SalesCta } from '@/components/pricing/sales-cta';
import pl from '@/i18n/messages/pl.json';

/**
 * Custom setup is a conversation, not a fifth plan card. The band belongs to the
 * organization surfaces only: `/manage/upgrade` after the grid and
 * `/pricing?audience=organization` after the ladder, for a signed-in manager and
 * a visitor alike. The individual ladder keeps its own closing band.
 */
const state = vi.hoisted(() => ({
  plans: [] as PlanInfo[],
  audience: null as 'individual' | 'organization' | null,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {} }),
  useSearchParams: () => new URLSearchParams(state.audience ? { audience: state.audience } : {}),
}));
vi.mock('@/components/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'manager-1', app_metadata: { account_type: 'manager' } } }),
}));
vi.mock('@/hooks/use-orgs', () => ({
  useOrgs: () => ({ activeOrg: { id: 'org-1' } }),
}));
vi.mock('@/hooks/use-api', () => ({
  useApiQuery: ({ url }: { url: string }) => {
    if (url.startsWith('/api/v1/subscription-plans')) {
      return { data: state.plans, isLoading: false };
    }
    return { data: undefined, isSuccess: false, isError: false };
  },
}));

function plan(
  key: string,
  scope: 'personal' | 'organization',
  priceMonthly: number,
  limits: Record<string, number> = {},
): PlanInfo {
  return {
    id: `plan-${key}`,
    key,
    name: `StudiQ ${key}`,
    description: null,
    priceMonthly,
    priceYearly: 0,
    currency: 'PLN',
    features: [],
    limits,
    sortOrder: 1,
    isActive: true,
    scope,
    seatEligible: false,
  };
}

const ORGANIZATION_PLANS = [
  plan('launch', 'organization', 0, { max_students: 5, max_groups: 3 }),
  plan('team', 'organization', 9900, { max_students: 25, max_groups: 10 }),
  plan('hub', 'organization', 29900, { max_students: 100, max_groups: 40 }),
  plan('campus', 'organization', 69900, { max_students: 1000, max_groups: 100 }),
];

const PERSONAL_PLANS = [
  plan('free', 'personal', 0),
  plan('plus', 'personal', 1999),
  plan('pro', 'personal', 3999),
  plan('max', 'personal', 7999),
];

function wrap(element: ReturnType<typeof createElement>): string {
  return renderToStaticMarkup(
    createElement(NextIntlClientProvider, { locale: 'pl', messages: pl, timeZone: 'UTC' }, element),
  );
}

function upgradeMarkup(scope: 'personal' | 'organization'): string {
  state.plans = scope === 'organization' ? ORGANIZATION_PLANS : PERSONAL_PLANS;
  return wrap(
    createElement(UpgradePlans, {
      scope,
      hasActivePlan: false,
      billingHref: '/manage/billing',
      orgId: 'org-1',
    }),
  );
}

function pricingMarkup(audience: 'individual' | 'organization'): string {
  state.audience = audience;
  state.plans = audience === 'organization' ? ORGANIZATION_PLANS : PERSONAL_PLANS;
  return wrap(createElement(PricingPageClient, { initialPlans: state.plans }));
}

function linkHrefs(markup: string): string[] {
  return [...markup.matchAll(/<a\b[^>]*\bhref="([^"]*)"/g)].map((match) => match[1]);
}

describe('SalesCta', () => {
  it('names the custom scope, links to the contact page and carries no price', () => {
    const markup = wrap(createElement(SalesCta));

    expect(markup).toContain(pl.PricingPage.sales_title);
    expect(markup).toContain(pl.PricingPage.sales_body);
    expect(linkHrefs(markup)).toContain('/contact');
    expect(markup).not.toMatch(/\d+\s*zł/);
    expect(markup).not.toContain('bg-signal');
    expect(markup).toContain('border-input');
  });
});

describe('the sales CTA on the organization surfaces', () => {
  it('follows the organization grid on the manager upgrade page', () => {
    const markup = upgradeMarkup('organization');

    expect(markup).toContain(pl.PricingPage.sales_title);
    expect(linkHrefs(markup)).toContain('/contact');
    expect(markup, 'the four tiers are the grid').toContain('do 25 uczniów');
  });

  it('follows the organization ladder for a signed-in manager', () => {
    const markup = pricingMarkup('organization');

    expect(markup).toContain(pl.PricingPage.sales_title);
    expect(linkHrefs(markup)).toContain('/contact');
  });

  it('stays off the personal upgrade page', () => {
    const markup = upgradeMarkup('personal');

    expect(markup).not.toContain(pl.PricingPage.sales_title);
    expect(linkHrefs(markup)).not.toContain('/contact');
  });

  it('stays off the individual ladder', () => {
    const markup = pricingMarkup('individual');

    expect(markup).not.toContain(pl.PricingPage.sales_title);
    expect(linkHrefs(markup)).not.toContain('/contact');
  });
});
