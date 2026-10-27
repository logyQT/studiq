'use client';

import type { PlanInfo } from '@studiq/server/services/subscription-plan.service';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle } from '@studiq/ui';
import { ArrowRight, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useApiQuery } from '@/hooks/use-api';
import { formatPlanPrice, pickLandingPlans } from '@/lib/landing-pricing';

/** Placeholder while the real plan prices load (or when they cannot be loaded). */
const NO_PRICE = '—';

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

  const plans = [
    {
      name: t('pricing_free_name'),
      price: price(free),
      period: '',
      desc: t('pricing_free_desc'),
      features: [t('free_questions'), t('free_flashcards'), t('free_quizzes'), t('free_stats')],
      cta: t('cta_start'),
      href: '/register',
      variant: 'outline' as const,
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
      variant: 'default' as const,
      popular: true,
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
      variant: 'outline' as const,
    },
  ];

  return (
    <section className="py-16 sm:py-24 bg-muted/30">
      <div className="mx-auto max-w-5xl">
        <div className="text-center mb-12">
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">{t('pricing_title')}</h2>
          <p className="mt-4 text-lg text-muted-foreground">{t('pricing_desc')}</p>
        </div>
        <div className="grid sm:grid-cols-3 gap-6">
          {plans.map((plan) => (
            <Card
              key={plan.href + plan.name}
              className={plan.popular ? 'border-primary shadow-lg relative' : 'border-border/50'}
            >
              {plan.popular && (
                <Badge className="absolute -top-3 left-1/2 -translate-x-1/2">
                  {pt('most_popular')}
                </Badge>
              )}
              <CardHeader>
                <CardTitle className="text-xl">{plan.name}</CardTitle>
                <p className="text-sm text-muted-foreground">{plan.desc}</p>
              </CardHeader>
              <CardContent>
                <div className="mb-6">
                  <span className="text-4xl font-bold">{plan.price}</span>
                  <span className="text-muted-foreground">{plan.period}</span>
                </div>
                <ul className="space-y-3 mb-8">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm">
                      <TrendingUp className="size-4 text-primary shrink-0" />
                      {f}
                    </li>
                  ))}
                </ul>
                <Button className="w-full" variant={plan.variant} asChild>
                  <Link href={plan.href}>{plan.cta}</Link>
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
        <div className="text-center mt-8">
          <Button variant="link" asChild>
            <Link href="/pricing">
              {t('pricing_cta')} <ArrowRight className="ml-1 size-4" />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
