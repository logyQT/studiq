'use client';

import type { PlanInfo } from '@studiq/server/services/subscription-plan.service';
import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { CtaButton } from '@/components/marketing/ui/cta-button';
import { ProductShot } from '@/components/marketing/ui/product-shot';
import { SectionHeader } from '@/components/marketing/ui/section-header';
import { useApiQuery } from '@/hooks/use-api';
import { formatPlanPrice, pickLandingPlans } from '@/lib/landing-pricing';
import { cn } from '@/lib/utils';

/** Placeholder while the real plan prices load (or when they cannot be loaded). */
const NO_PRICE = '—';

type PlanColumn = {
  name: string;
  /** Already formatted in the visitor locale, or NO_PRICE. */
  price: string;
  /** "/miesiąc" only where the plan is actually billed monthly. */
  period: string;
  desc: string;
  features: string[];
  cta: string;
  href: string;
  recommended?: boolean;
};

export function Pricing() {
  const t = useTranslations('LandingPage');
  const pt = useTranslations('PricingPage');
  const locale = useLocale();

  const { data: student } = useApiQuery<PlanInfo[]>({
    queryKey: ['subscription-plans', 'active', 'student'],
    url: '/api/v1/subscription-plans?for=student',
  });
  const { data: manager } = useApiQuery<PlanInfo[]>({
    queryKey: ['subscription-plans', 'active', 'manager'],
    url: '/api/v1/subscription-plans?for=manager',
  });
  const { free, premium, organizationFrom } = pickLandingPlans(student ?? [], manager ?? []);

  const price = (plan: PlanInfo | null) => (plan ? formatPlanPrice(plan, locale) : NO_PRICE);

  const plans: PlanColumn[] = [
    {
      name: t('pricing_free_name'),
      price: price(free),
      period: '',
      desc: t('pricing_free_desc'),
      features: [t('free_questions'), t('free_flashcards'), t('free_quizzes'), t('free_stats')],
      cta: t('cta_start'),
      href: '/register',
    },
    {
      name: t('pricing_premium_name'),
      price: price(premium),
      period: premium ? pt('period_month') : '',
      desc: t('pricing_premium_desc'),
      features: [
        t('free_questions'),
        t('free_flashcards'),
        t('free_quizzes'),
        t('free_stats'),
        t('ai_generate_questions'),
        t('ai_generate_flashcards'),
        t('ai_exam_sim'),
      ],
      cta: t('pricing_premium_cta'),
      href: '/register',
      recommended: true,
    },
    {
      name: t('pricing_university_name'),
      price: organizationFrom
        ? t('pricing_from', { price: formatPlanPrice(organizationFrom, locale) })
        : NO_PRICE,
      period: organizationFrom ? pt('period_month') : '',
      desc: t('pricing_university_desc'),
      features: [
        t('pricing_university_feature_premium'),
        t('pricing_university_feature_management'),
        t('pricing_university_feature_roles'),
        t('pricing_university_feature_invites'),
        t('pricing_university_feature_analytics'),
        t('pricing_university_feature_support'),
      ],
      cta: t('pricing_contact_cta'),
      href: '/contact',
    },
  ];

  const lastIndex = plans.length - 1;

  return (
    // Top padding is short of the section default for the same reason as
    // `how-it-works`: the measured gap above it was 178px, and 160px is the rhythm.
    <section id="pricing" className="pt-12 pb-16 md:pt-16 md:pb-20">
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

        {/* A three-column ledger: rules carry the separation, so no column is a card. */}
        <ul className="mt-10 grid border-t border-border md:mt-12 md:grid-cols-3">
          {plans.map((plan, index) => (
            <li
              key={`${plan.href}-${plan.name}`}
              className={cn(
                /*
                 * Below md the plan is a compact block: name and price share one
                 * baseline row, everything after it spans the full width. The li
                 * returns to a flex column from md, where the three plans sit
                 * side by side and the CTA is pushed to the shared bottom edge.
                 */
                'relative grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 border-b border-border py-6 md:flex md:flex-col md:items-stretch md:border-b-0 md:py-10',
                index === 0 && 'md:pr-8',
                index > 0 && 'md:border-l md:border-border',
                index > 0 && index < lastIndex && 'md:px-8',
                index === lastIndex && 'md:pl-8',
              )}
            >
              {plan.recommended ? (
                // The accent marks the recommended column; it never fills it.
                <span
                  aria-hidden="true"
                  className="absolute inset-x-0 -top-px block h-0.5 bg-signal"
                />
              ) : null}

              <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 md:justify-between">
                <h3 className="font-display text-h3 font-semibold">{plan.name}</h3>
                {plan.recommended ? (
                  <span className="font-mono text-xs uppercase tracking-[0.08em] text-primary">
                    {t('pricing_recommended')}
                  </span>
                ) : null}
              </div>
              <p className="col-span-2 mt-2 text-sm text-muted-foreground text-pretty">
                {plan.desc}
              </p>

              <p className="col-start-2 row-start-1 flex flex-wrap items-baseline gap-x-1.5 md:mt-6">
                <span className="font-mono text-h3 font-medium tabular-nums md:text-h2">
                  {plan.price}
                </span>
                {plan.period ? (
                  <span className="text-sm text-muted-foreground">{plan.period}</span>
                ) : null}
              </p>

              <ul className="col-span-2 mt-6 border-t border-border md:mt-8">
                {plan.features.map((feature) => (
                  <li key={feature} className="border-b border-border py-2 text-sm md:py-2.5">
                    {feature}
                  </li>
                ))}
              </ul>

              <div className="col-span-2 mt-auto flex flex-col pt-6 md:block md:pt-8">
                <CtaButton href={plan.href} tone="quiet">
                  {plan.cta}
                </CtaButton>
              </div>
            </li>
          ))}
        </ul>

        {/*
         * The institutional tier in one strip: seat pools, what is assigned and
         * what is left. It sits under the whole ledger rather than inside the
         * third column (310px) because the table's own labels are small type at
         * 3x, and a column would downscale them to noise. The ledger stays the
         * comparison; this is the thing an organisation actually buys.
         *
         * Not below md: at 390px the strip renders 358px wide, a quarter of the
         * capture, and the column headings become unreadable.
         */}
        <ProductShot
          shot="seats-table"
          alt={t('shot_seats_alt')}
          sizes="(min-width: 1280px) 1056px, calc(100vw - 4rem)"
          className="mt-10 hidden md:mt-12 md:block"
        />
      </div>
    </section>
  );
}
