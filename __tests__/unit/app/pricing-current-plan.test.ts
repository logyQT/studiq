import type { PlanInfo } from '@studiq/server/services/subscription-plan.service';
import { NextIntlClientProvider } from 'next-intl';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { PricingPageClient } from '@/app/(frontend)/pricing/_components/pricing-page-client';
import pl from '@/i18n/messages/pl.json';

/**
 * The badge must follow the ladder on screen. A manager reading the
 * organization ladder is the org's billing contact, so `/me/plan` answers with
 * the organization's plan (#228); on the individual ladder the same manager
 * reads their own plan. Reading `/me/plan` on both badges the org plan on the
 * personal ladder, which is the wrong plan for that reader.
 */
const state = vi.hoisted(() => ({
  audience: null as string | null,
  urls: [] as string[],
  plans: [] as PlanInfo[],
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
    state.urls.push(url);
    if (url === '/api/v1/subscription-plans') return { data: state.plans, isLoading: false };
    return { data: undefined };
  },
}));

function plan(key: string, scope: 'personal' | 'organization'): PlanInfo {
  return {
    id: `plan-${key}`,
    key,
    name: `StudiQ ${key}`,
    description: null,
    priceMonthly: 0,
    priceYearly: 0,
    currency: 'PLN',
    features: [],
    limits: {},
    sortOrder: 1,
    isActive: true,
    scope,
    audience: null,
    seatEligible: false,
  };
}

function render(audience: string | null, plans: PlanInfo[]): void {
  state.audience = audience;
  state.urls = [];
  state.plans = plans;

  renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale: 'pl', messages: pl, timeZone: 'UTC' },
      createElement(PricingPageClient, { initialPlans: plans }),
    ),
  );
}

describe('/pricing current-plan badge', () => {
  it('reads the manager’s personal plan on the individual ladder', () => {
    render(null, [plan('base', 'personal')]);

    expect(state.urls).toContain('/api/v1/me/personal-plan');
    expect(state.urls).not.toContain('/api/v1/me/plan');
  });

  it('reads /me/plan for a manager on the organization ladder', () => {
    render('organization', [plan('launch', 'organization')]);

    expect(state.urls).toContain('/api/v1/me/plan');
    expect(state.urls).not.toContain('/api/v1/me/personal-plan');
  });
});
