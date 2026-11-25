import type { PlanInfo } from '@studiq/server/services/subscription-plan.service';
import { createTranslator, NextIntlClientProvider } from 'next-intl';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { CheckoutMockForm } from '@/components/checkout/checkout-mock-form';
import pl from '@/i18n/messages/pl.json';
import type { CheckoutOrg } from '@/lib/checkout-org';

/**
 * #813: `/checkout` must not offer a payment form for a plan the server will
 * refuse because of the buyer's account type.
 */
interface Page {
  plan: PlanInfo | undefined;
  accountType: unknown;
  orgId: string | null;
}

const page = vi.hoisted((): Page => ({ plan: undefined, accountType: undefined, orgId: null }));

const ORG: CheckoutOrg = { id: 'org-1', name: 'Szkoła', canBill: true, isActive: true };

vi.mock('@/hooks/use-api', () => ({
  useApiQuery: ({ url }: { url: string }) => ({
    data: url === '/api/v1/me/orgs' ? [ORG] : page.plan,
    isPending: false,
    isError: false,
    refetch: () => {},
  }),
}));
vi.mock('@/components/providers/AuthProvider', () => ({
  useAuth: () => ({
    user: { id: 'user-1', app_metadata: { account_type: page.accountType } },
    isLoading: false,
  }),
}));
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: () => {}, replace: () => {} }),
  useSearchParams: () =>
    new URLSearchParams({
      plan_id: page.plan?.key ?? '',
      ...(page.orgId ? { org_id: page.orgId } : {}),
    }),
}));

const t = createTranslator({ locale: 'pl', messages: pl, namespace: 'CheckoutPage' });

function plan(key: string, scope: string, audience: string | null): PlanInfo {
  return {
    id: `id-${key}`,
    key,
    name: key,
    description: null,
    priceMonthly: 999,
    priceYearly: 0,
    currency: 'PLN',
    features: [],
    limits: {},
    sources: [],
    sortOrder: 1,
    isActive: true,
    scope,
    audience,
    seatEligible: false,
  };
}

const spark = plan('spark', 'personal', 'student');
const lite = plan('lite', 'personal', 'educator');
const hub = plan('hub', 'organization', null);

function render(buyer: unknown, bought: PlanInfo, orgId: string | null = null): string {
  page.accountType = buyer;
  page.plan = bought;
  page.orgId = orgId;
  return renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale: 'pl', messages: pl, timeZone: 'UTC' },
      createElement(CheckoutMockForm),
    ),
  );
}

describe('CheckoutMockForm and the account type (#813)', () => {
  beforeEach(() => {
    page.orgId = null;
  });

  it.each([
    ['a student buying an educator plan', 'student', lite],
    ['an educator buying a student plan', 'educator', spark],
    ['a manager buying a student plan', 'manager', spark],
    ['a buyer without an account type', undefined, spark],
    ['a buyer with an unknown account type', 'admin', spark],
  ])('blocks %s', (_label, buyer, bought) => {
    const markup = render(buyer, bought);

    expect(markup).not.toContain('<form');
    expect(markup).not.toContain('id="cardNumber"');
    expect(markup).toContain(t('checkout_unavailable_title'));
    expect(markup).toContain(t('checkout_unavailable_description'));
    expect(markup).toContain(t('back_to_plans'));
  });

  it('offers the form for a plan of the buyer’s account type', () => {
    const markup = render('student', spark);

    expect(markup).toContain('id="cardNumber"');
    expect(markup).not.toContain(t('checkout_unavailable_title'));
  });

  it('offers the form for an organization the buyer may bill, whatever the account type', () => {
    const markup = render('student', hub, ORG.id);

    expect(markup).toContain('id="cardNumber"');
    expect(markup).not.toContain(t('checkout_unavailable_title'));
  });

  it('keeps the organization’s own refusal for an organization plan without an org', () => {
    const markup = render('student', hub);

    expect(markup).not.toContain('id="cardNumber"');
    expect(markup).toContain(t('org_missing_title'));
    expect(markup).not.toContain(t('checkout_unavailable_title'));
  });
});
