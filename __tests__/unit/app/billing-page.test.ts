import { AccountType } from '@studiq/authz';
import type { BillingSubscriptionView } from '@studiq/server/services/billing.service';
import type { PlanInfo } from '@studiq/server/services/subscription-plan.service';
import { createTranslator, NextIntlClientProvider } from 'next-intl';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BillingPage } from '@/components/billing/billing-page';
import pl from '@/i18n/messages/pl.json';

/**
 * `/me/plan` is the *effective* composition since ADR-0015 phase 3b: its
 * org-scope limits are 0 outside a verified org and its feature list is the
 * union of every layer. A card titled with one plan's name and price must show
 * that plan's catalogue row, so this pins the card against the effective union
 * leaking back into it.
 */
interface QueryData {
  plan: PlanInfo | undefined;
  plans: PlanInfo[] | undefined;
  subscription: BillingSubscriptionView | undefined;
}

const data = vi.hoisted((): QueryData => ({
  plan: undefined,
  plans: undefined,
  subscription: undefined,
}));

vi.mock('@/hooks/use-api', () => ({
  useApiQuery: ({ url }: { url: string }) => {
    if (url === '/api/v1/me/plan') return { data: data.plan, isLoading: false };
    if (url === '/api/v1/subscription-plans') return { data: data.plans };
    return { data: data.subscription, isError: false, refetch: () => {} };
  },
}));
vi.mock('@/components/providers/AuthProvider', () => ({
  useAuth: () => ({ user: { id: 'user-1' } }),
}));
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: () => {} }),
}));

const locale = 'pl';
const pt = createTranslator({ locale, messages: pl, namespace: 'PricingPage' });

function plan(overrides: Partial<PlanInfo> & Pick<PlanInfo, 'key' | 'limits'>): PlanInfo {
  return {
    id: `id-${overrides.key}`,
    name: 'Lite',
    description: null,
    priceMonthly: 1900,
    priceYearly: 19000,
    currency: 'PLN',
    features: ['flashcards'],
    sources: [],
    sortOrder: 1,
    isActive: true,
    scope: 'personal',
    audience: null,
    seatEligible: false,
    ...overrides,
  };
}

function render(): string {
  return renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale, messages: pl, timeZone: 'UTC' },
      createElement(BillingPage, {
        accountType: AccountType.EDUCATOR,
        upgradePath: '/edu/upgrade',
      }),
    ),
  );
}

describe('BillingPage current-plan card', () => {
  beforeEach(() => {
    // Names differ so the header's source is observable: the card names the
    // `/me/plan` row, while the lists must come from the catalogue row.
    data.plan = plan({
      key: 'lite',
      name: 'Lite effective',
      features: ['flashcards', 'branding'],
      limits: { max_flashcards: 100, max_students: 0, max_groups: 0 },
    });
    data.plans = [
      plan({
        key: 'lite',
        priceMonthly: 2900,
        limits: { max_flashcards: 100, max_students: 5, max_groups: 50 },
      }),
    ];
  });

  it('takes the price from /me/plan and the name from its catalogue row', () => {
    const markup = render();

    // The badge names the catalogue row; the effective row's name is not shown.
    expect(markup).toContain('Lite');
    // The catalogue row prices at 29,00, so this reads the header's source.
    expect(markup).toContain('19,00');
    expect(markup).not.toContain('Lite effective');
  });

  it('renders the feature and limit lists from the catalogue row, not the effective union', () => {
    const markup = render();

    // Org-scope limits are 0 in the effective row outside a verified org; the
    // catalogue advertises 5/50 and must win.
    expect(markup).toContain('>5</span>');
    expect(markup).toContain('>50</span>');
    expect(markup).not.toContain('tabular-nums">0<');
    // `branding` is in the effective union (the org layer) but not on `lite`.
    expect(markup).not.toContain(pt('feature_branding'));
  });

  it('leaves the lists empty while the catalogue is unavailable, never the effective union', () => {
    data.plans = undefined;
    const markup = render();

    expect(markup).toContain('Lite effective');
    expect(markup).not.toContain('tabular-nums');
    expect(markup).not.toContain(pt('feature_branding'));
  });
});
