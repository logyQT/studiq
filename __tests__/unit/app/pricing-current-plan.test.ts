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
 *
 * The change-plan destination is the *plan's* scope, not the ladder: a personal
 * plan is changed on the reader's own billing page, an organization plan on the
 * org dashboard (#1493 follow-up).
 */
const state = vi.hoisted(() => ({
  urls: [] as string[],
  plans: [] as PlanInfo[],
  currentPlan: undefined as PlanInfo | undefined,
  planPending: false,
  accountType: 'manager',
  audience: null as 'individual' | 'organization' | null,
}));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {} }),
  useSearchParams: () => new URLSearchParams(state.audience ? { audience: state.audience } : {}),
}));
vi.mock('@/components/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'reader-1', app_metadata: { account_type: state.accountType } } }),
}));
vi.mock('@/hooks/use-orgs', () => ({
  useOrgs: () => ({ activeOrg: { id: 'org-1' } }),
}));
vi.mock('@/hooks/use-api', () => ({
  useApiQuery: ({ url, enabled }: { url: string; enabled?: boolean }) => {
    if (enabled === false) return { data: undefined, isSuccess: false, isError: false };
    state.urls.push(url);
    if (url === '/api/v1/subscription-plans') return { data: state.plans, isLoading: false };
    if (url.startsWith('/api/v1/me/')) {
      return {
        data: state.currentPlan,
        isSuccess: !state.planPending && state.currentPlan !== undefined,
        isError: false,
      };
    }
    return { data: undefined };
  },
}));

function plan(key: string, scope: 'personal' | 'organization', priceMonthly = 0): PlanInfo {
  return {
    id: `plan-${key}`,
    key,
    name: `StudiQ ${key}`,
    description: null,
    priceMonthly,
    priceYearly: 0,
    currency: 'PLN',
    features: [],
    limits: {},
    sortOrder: 1,
    isActive: true,
    scope,
    seatEligible: false,
  };
}

function render(input: {
  audience?: string | null;
  plans: PlanInfo[];
  currentPlan?: PlanInfo;
  planPending?: boolean;
  accountType?: string;
}): string {
  state.audience = input.audience ?? null;
  state.urls = [];
  state.plans = input.plans;
  state.currentPlan = input.currentPlan;
  state.planPending = input.planPending ?? false;
  state.accountType = input.accountType ?? 'manager';

  return renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale: 'pl', messages: pl, timeZone: 'UTC' },
      createElement(PricingPageClient, { initialPlans: input.plans }),
    ),
  );
}

describe('/pricing current-plan badge', () => {
  it('asks nothing for a manager on the individual ladder (ADR-0007)', () => {
    const markup = render({ plans: [plan('free', 'personal'), plan('plus', 'personal', 1900)] });

    // A manager holds no personal plan, so the endpoint would answer NOT_FOUND.
    expect(state.urls).not.toContain('/api/v1/me/personal-plan');
    expect(state.urls).not.toContain('/api/v1/me/plan');
    // No purchase or change action either: the checkout refuses a personal plan.
    expect(markup).not.toContain('href="/app/billing"');
    expect(markup).not.toContain('Wybierz Plus');
  });

  it('reads the personal plan for a content subscriber on the individual ladder', () => {
    render({ audience: 'individual', accountType: 'student', plans: [plan('free', 'personal')] });

    expect(state.urls).toContain('/api/v1/me/personal-plan');
    expect(state.urls).not.toContain('/api/v1/me/plan');
  });

  it('reads /me/plan for a manager on the organization ladder', () => {
    render({ audience: 'organization', plans: [plan('launch', 'organization')] });

    expect(state.urls).toContain('/api/v1/me/plan');
    expect(state.urls).not.toContain('/api/v1/me/personal-plan');
  });
});

describe('/pricing change-plan destination', () => {
  it('sends a personal subscriber to the personal billing page regardless of the ladder', () => {
    // The organization ladder is on screen, but the reader owns a personal plan:
    // the destination follows the plan's scope, not the audience radios.
    const markup = render({
      audience: 'organization',
      accountType: 'student',
      plans: [plan('plus', 'personal', 1900), plan('hub', 'organization', 4999)],
      currentPlan: plan('max', 'personal', 1999),
    });

    expect(markup).toContain('href="/app/billing"');
    expect(markup).not.toContain('href="/manage/billing"');
  });

  it('sends an educator’s personal subscriber to the educator billing page', () => {
    const markup = render({
      plans: [plan('free', 'personal'), plan('plus', 'personal', 1900)],
      currentPlan: plan('max', 'personal', 1999),
      accountType: 'educator',
    });

    expect(markup).toContain('href="/edu/billing"');
  });

  it('sends an organization subscriber to the org dashboard', () => {
    const markup = render({
      audience: 'organization',
      plans: [plan('hub', 'organization', 4999), plan('scale', 'organization', 9999)],
      currentPlan: plan('hub', 'organization', 4999),
    });

    expect(markup).toContain('href="/manage/billing"');
    expect(markup).not.toContain('href="/app/billing"');
  });

  it('prints no action while the plan read is pending', () => {
    const markup = render({
      plans: [plan('free', 'personal'), plan('plus', 'personal', 1900)],
      planPending: true,
      accountType: 'student',
    });

    expect(markup).not.toContain('href="/app/billing"');
    expect(markup).not.toContain('href="/manage/billing"');
  });
});
