'use client';

import type { PlanInfo } from '@studiq/server/services/subscription-plan.service';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { CtaButton } from '@/components/marketing/ui/cta-button';
import { SectionHeader } from '@/components/marketing/ui/section-header';
import { useApiQuery } from '@/hooks/use-api';
import { formatPlanPrice, pickLandingPlans } from '@/lib/landing-pricing';
import { cn } from '@/lib/utils';

type PlanColumn = {
  name: string;
  /** The formatted figure, or null until the prices arrive and when they never do. */
  price: string | null;
  /** "/miesiąc" only where the plan is actually billed monthly. */
  period: string;
  desc: string;
  /**
   * The rows this plan repeats from a lower tier. Below md they collapse into one muted
   * line, because a phone reads one offer at a time and four repeated rows are scroll
   * rather than information. From md the ledger prints them: three columns are read across,
   * and a row a plan has but does not show is a comparison the visitor cannot make.
   */
  inherited?: { line: string; rows: string[] };
  /** What this plan adds on top of what it inherits — the only rows that earn ink at phone. */
  added: string[];
  cta: string;
  href: string;
  recommended?: boolean;
};

export function Pricing() {
  const t = useTranslations('LandingPage');
  const pt = useTranslations('PricingPage');
  const locale = useLocale();

  const {
    data: student,
    isLoading: studentLoading,
    isError: studentFailed,
  } = useApiQuery<PlanInfo[]>({
    queryKey: ['subscription-plans', 'active', 'student'],
    url: '/api/v1/subscription-plans?for=student',
  });
  const {
    data: manager,
    isLoading: managerLoading,
    isError: managerFailed,
  } = useApiQuery<PlanInfo[]>({
    queryKey: ['subscription-plans', 'active', 'manager'],
    url: '/api/v1/subscription-plans?for=manager',
  });
  const { free, premium, organizationFrom } = pickLandingPlans(student ?? [], manager ?? []);

  // A price is a number from the database or it is absent. The em dash is the
  // not-included mark on /pricing, so it cannot stand in for "still loading".
  const price = (plan: PlanInfo | null) => (plan ? formatPlanPrice(plan, locale) : null);
  const pricesPending = studentLoading || managerLoading;
  const pricesFailed = (studentFailed || managerFailed) && !pricesPending;

  const freeRows = [t('free_questions'), t('free_flashcards'), t('free_quizzes'), t('free_stats')];

  const plans: PlanColumn[] = [
    {
      name: t('pricing_free_name'),
      price: price(free),
      period: '',
      desc: t('pricing_free_desc'),
      added: freeRows,
      cta: t('cta_start'),
      href: '/register',
    },
    {
      name: t('pricing_premium_name'),
      price: price(premium),
      period: premium ? pt('period_month') : '',
      desc: t('pricing_premium_desc'),
      inherited: { line: t('pricing_inherits_free'), rows: freeRows },
      added: [t('ai_generate_questions'), t('ai_generate_flashcards')],
      cta: t('pricing_premium_cta'),
      href: '/register',
      recommended: true,
    },
    {
      name: t('pricing_university_name'),
      price: organizationFrom
        ? t('pricing_from', { price: formatPlanPrice(organizationFrom, locale) })
        : null,
      period: organizationFrom ? pt('period_month') : '',
      desc: t('pricing_university_desc'),
      inherited: {
        line: t('pricing_university_feature_premium'),
        rows: [t('pricing_university_feature_premium')],
      },
      added: [
        t('pricing_university_feature_management'),
        t('pricing_university_feature_roles'),
        t('pricing_university_feature_invites'),
        t('pricing_university_feature_analytics'),
        t('pricing_university_feature_support'),
      ],
      cta: t('pricing_org_cta'),
      href: '/pricing/org',
    },
  ];

  const lastIndex = plans.length - 1;

  return (
    // Top padding is short of the section default for the same reason as
    // `how-it-works`: the measured gap above it was 178px, and 160px is the rhythm.
    // The bottom is longer than that rhythm at phone so the last action keeps 128px of
    // paper before the cobalt band; the block's own `py-6` covers the rest.
    <section id="pricing" className="pt-12 pb-26 md:pt-16 md:pb-20">
      <div className="mx-auto max-w-content px-content">
        <div className="grid gap-6 md:grid-cols-12 md:items-end">
          <div className="md:col-span-8">
            <SectionHeader title={t('pricing_title')} lede={t('pricing_desc')} />
          </div>
          <div className="md:col-span-4 md:justify-self-end md:pb-1">
            <Link
              href="/pricing"
              className="group -my-3 inline-flex min-h-11 items-center gap-2 rounded-control py-3 text-sm font-semibold text-primary transition-colors hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none md:my-0 md:min-h-0 md:py-0"
            >
              {t('pricing_cta')}
              <ArrowRight
                aria-hidden="true"
                className="size-4 motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5"
              />
            </Link>
          </div>
        </div>

        {/*
         * A three-column ledger: rules carry the separation, so no column is a card.
         * Below md the ledger turns vertical — each plan is its own column, upright: the
         * same stack that reads across at md, in the same order, with no grid re-ordering.
         * Its one hairline is the md ledger's vertical rule turned horizontal.
         */}
        <ul className="mt-10 grid border-t border-border md:mt-12 md:grid-cols-3">
          {plans.map((plan, index) => (
            <li
              key={`${plan.href}-${plan.name}`}
              className={cn(
                'relative flex flex-col border-b border-border py-6 md:border-b-0 md:py-10',
                index === 0 && 'md:pr-8',
                index > 0 && 'md:border-l md:border-border',
                index > 0 && index < lastIndex && 'md:px-8',
                index === lastIndex && 'md:pl-8',
              )}
            >
              {plan.recommended ? (
                // The accent marks the recommended column. A phone has no columns, so the
                // label alone carries the recommendation there and the bar stays at md.
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 -top-px hidden h-0.5 bg-signal md:block"
                />
              ) : null}

              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 md:justify-between">
                <h3 className="text-h3 font-semibold">{plan.name}</h3>
                {plan.recommended ? (
                  <span className="font-mono text-xs uppercase tracking-[0.08em] text-primary">
                    {t('pricing_recommended')}
                  </span>
                ) : null}
              </div>
              <p className="mt-2 text-sm text-muted-foreground text-pretty">{plan.desc}</p>

              {plan.price !== null || pricesPending ? (
                // The figure gets its own line and its own fixed box, so a slow response
                // cannot move the rows below it. Left-aligned: this is a figure, not a
                // price list's right-hand gutter.
                <p className="mt-5 flex h-7 flex-wrap items-baseline gap-x-1.5 md:mt-6 md:h-auto">
                  {plan.price !== null ? (
                    <>
                      <span className="font-mono text-h3 font-medium tabular-nums md:text-h2">
                        {plan.price}
                      </span>
                      {plan.period ? (
                        <span className="text-sm text-muted-foreground">{plan.period}</span>
                      ) : null}
                    </>
                  ) : (
                    <>
                      <span aria-hidden="true" className="h-px w-24 self-center bg-border" />
                      <span className="sr-only">{t('pricing_price_loading')}</span>
                    </>
                  )}
                </p>
              ) : null}

              <ul className="mt-6 md:mt-8 md:border-t md:border-border">
                {plan.inherited ? (
                  <>
                    <li className="py-2 text-sm text-muted-foreground md:hidden">
                      {plan.inherited.line}
                    </li>
                    {plan.inherited.rows.map((row) => (
                      <li
                        key={`inherited-${row}`}
                        className="hidden py-2 text-sm md:block md:border-b md:border-border md:py-2.5"
                      >
                        {row}
                      </li>
                    ))}
                  </>
                ) : null}
                {plan.added.map((row) => (
                  <li key={row} className="py-2 text-sm md:border-b md:border-border md:py-2.5">
                    {row}
                  </li>
                ))}
              </ul>

              <div className="mt-auto flex flex-col pt-6 md:block md:pt-8">
                {/*
                 * One primary action in the section: the recommended plan's fill. Free and
                 * Organizations are links in the page's link language, because three lime
                 * buttons would be no primary at all. At md the three buttons are the peers
                 * of the ledger's columns, so the quiet outline stays as it is.
                 */}
                <div className="md:hidden">
                  {plan.recommended ? (
                    <CtaButton href={plan.href} tone="signal">
                      {plan.cta}
                    </CtaButton>
                  ) : (
                    <Link
                      href={plan.href}
                      className="group inline-flex min-h-11 items-center gap-2 rounded-control text-sm font-semibold text-primary transition-colors hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
                    >
                      {plan.cta}
                      <ArrowRight
                        aria-hidden="true"
                        className="size-4 motion-safe:transition-transform motion-safe:group-hover:translate-x-0.5"
                      />
                    </Link>
                  )}
                </div>
                <div className="hidden md:block">
                  <CtaButton href={plan.href} tone="quiet">
                    {plan.cta}
                  </CtaButton>
                </div>
              </div>
            </li>
          ))}
        </ul>

        {pricesFailed ? (
          // Absent prices are stated once, in words, under the ledger. No figure is
          // invented, and the three blocks do not each carry a broken-looking slot.
          <p className="mt-6 text-sm">
            <Link
              href="/pricing"
              className="inline-flex items-center gap-1.5 rounded-control font-semibold text-primary underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background focus-visible:outline-none"
            >
              {t('pricing_unavailable')}
              <ArrowRight aria-hidden="true" className="size-4" />
            </Link>
          </p>
        ) : null}
      </div>
    </section>
  );
}
