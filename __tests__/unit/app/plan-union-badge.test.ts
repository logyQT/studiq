import type { PlanInfo } from '@studiq/server/services/subscription-plan.service';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';
import { PlanUnionBadge } from '@/components/billing/plan-union-badge';
import pl from '@/i18n/messages/pl.json';

/**
 * `/me/plan` resolves the union of every plan layer (ADR-0015 §6.1, D28). A
 * screen that says "your plan" must name that union with its provenance, not
 * hide a paid personal plan under the primary plan's name (`#971`), and it must
 * read names from the catalogue the client already holds.
 */
function plan(overrides: Partial<PlanInfo> & Pick<PlanInfo, 'key'>): PlanInfo {
  return {
    id: `id-${overrides.key}`,
    name: overrides.key,
    description: null,
    priceMonthly: 0,
    priceYearly: 0,
    currency: 'PLN',
    features: [],
    limits: {},
    sources: [],
    sortOrder: 1,
    isActive: true,
    scope: 'personal',
    seatEligible: false,
    ...overrides,
  };
}

function render(
  badge: PlanInfo,
  catalogue: PlanInfo[] | undefined,
  variant?: 'default' | 'secondary',
): string {
  return renderToStaticMarkup(
    createElement(
      NextIntlClientProvider,
      { locale: 'pl', messages: pl, timeZone: 'UTC' },
      createElement(PlanUnionBadge, { plan: badge, plans: catalogue, variant }),
    ),
  );
}

describe('PlanUnionBadge', () => {
  it('keeps the generic badge mark and adds its own locator', () => {
    const markup = render(plan({ key: 'hub', name: 'Hub' }), [plan({ key: 'hub', name: 'Hub' })]);

    expect(markup).toContain('data-slot="badge"');
    expect(markup).toContain('data-plan-union="true"');
  });

  it('keeps the surface variant, secondary by default', () => {
    const catalogue = [plan({ key: 'hub', name: 'Hub' })];

    expect(render(plan({ key: 'hub' }), catalogue)).toContain('bg-secondary');
    expect(render(plan({ key: 'hub' }), catalogue, 'default')).toContain('bg-primary');
  });

  it('names a single-layer plan by its catalogue row', () => {
    const catalogue = [plan({ key: 'hub', name: 'Hub' })];

    expect(render(plan({ key: 'hub', name: 'Hub effective' }), catalogue)).toContain('Hub');
    expect(render(plan({ key: 'hub', name: 'Hub effective' }), catalogue)).not.toContain(
      'Hub effective',
    );
  });

  it('names every layer with its origin when the union has several', () => {
    const catalogue = [
      plan({ key: 'hub', name: 'Hub' }),
      plan({ key: 'max', name: 'Pro' }),
      plan({ key: 'solo', name: 'Solo' }),
    ];
    const badge = plan({
      key: 'hub',
      name: 'Hub effective',
      sources: [
        { planKey: 'hub', origin: 'org' },
        { planKey: 'max', origin: 'seat' },
        { planKey: 'solo', origin: 'personal' },
      ],
    });

    expect(render(badge, catalogue)).toContain(
      'Hub (organizacja) + Pro (licencja) + Solo (plan osobisty)',
    );
  });

  it('falls back to an unknown layer key rather than dropping the layer', () => {
    const catalogue = [plan({ key: 'hub', name: 'Hub' })];
    const badge = plan({
      key: 'hub',
      sources: [
        { planKey: 'hub', origin: 'org' },
        { planKey: 'retired-plan', origin: 'personal' },
      ],
    });

    expect(render(badge, catalogue)).toContain('Hub (organizacja) + retired-plan (plan osobisty)');
  });

  it('falls back to the plan name when the catalogue has not loaded', () => {
    expect(render(plan({ key: 'hub', name: 'Hub effective' }), undefined)).toContain(
      'Hub effective',
    );
  });
});
