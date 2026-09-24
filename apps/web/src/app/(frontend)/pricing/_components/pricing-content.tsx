'use client';

import type { PlanInfo } from '@studiq/server/services/subscription-plan.service';
import { Badge, Button, Card, CardContent, CardHeader, CardTitle, Separator } from '@studiq/ui';
import { Check, Loader2, Minus, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { MainLayout } from '@/components/layout/MainLayout';
import { CheckoutButton } from '@/components/pricing/checkout-button';
import { useAuth } from '@/components/providers/AuthProvider';
import { useApiQuery } from '@/hooks/use-api';

const PLAN_ID_MAP: Record<string, string | null> = {
  base: null,
  lite: null,
  launch: null,
  spark: 'spark',
  ace: 'ace',
  pro: 'pro',
  guide: 'guide',
  creator: 'creator',
  master: 'master',
  team: 'team',
  hub: 'hub',
  campus: 'campus',
};

const CTA_KEY_MAP: Record<string, string> = {
  base: 'cta_free',
  spark: 'cta_spark',
  ace: 'cta_ace',
  pro: 'cta_pro',
  lite: 'cta_free',
  guide: 'cta_guide',
  creator: 'cta_creator',
  master: 'cta_master',
  launch: 'cta_free',
  team: 'cta_team',
  hub: 'cta_hub',
  campus: 'cta_campus',
};

const SORTED_LIMIT_KEYS = [
  'max_flashcards',
  'max_decks',
  'max_questions',
  'max_question_banks',
  'max_quiz_attempts_per_day',
  'max_ai_tokens_per_day',
  'max_students',
  'max_groups',
  'max_storage_mb',
];

function getFeatureLabel(key: string, t: (k: string) => string): string {
  const labels: Record<string, string> = {
    flashcards: t('feature_flashcards'),
    quiz: t('feature_quiz'),
    ai: t('feature_ai'),
    quiz_builder: t('feature_quiz_builder'),
    documents: t('feature_documents'),
    org_manage: t('feature_org_manage'),
    advanced_stats: t('feature_advanced_stats'),
    group_manage: t('feature_group_manage'),
    member_manage: t('feature_member_manage'),
    role_builder: t('feature_role_builder'),
    branding: t('feature_branding'),
  };
  return labels[key] ?? key;
}

function formatLimitValue(key: string, value: number, t: (k: string) => string): string {
  if (value === -1) return t('limit_unlimited');
  if (key === 'max_ai_tokens_per_day') {
    return value >= 1000 ? `${(value / 1000).toLocaleString()}k / day` : `${value} / day`;
  }
  return value.toLocaleString();
}

export function PlanCard({
  plan,
  isCurrentPlan,
  user,
  t,
  accountType,
}: {
  plan: PlanInfo;
  isCurrentPlan: boolean;
  user: unknown;
  t: (key: string) => string;
  accountType: string;
}) {
  const locale = useLocale();
  const popular =
    accountType === 'student'
      ? plan.key === 'ace'
      : accountType === 'educator'
        ? plan.key === 'creator'
        : plan.key === 'hub';

  return (
    <Card
      className={`flex flex-col relative ${popular ? 'border-primary shadow-lg' : 'border-border/50'}`}
    >
      {popular && (
        <Badge className="absolute -top-3 left-1/2 -translate-x-1/2 z-10">
          <Sparkles className="size-3 mr-1" />
          {t('most_popular')}
        </Badge>
      )}
      {isCurrentPlan && (
        <Badge variant="secondary" className="absolute -top-3 right-4 z-10">
          {t('current_plan_badge')}
        </Badge>
      )}
      <CardHeader className="pb-4">
        <CardTitle className="text-xl">{plan.name}</CardTitle>
        <p className="text-sm">
          {t(`plan_${plan.key}_desc`)
            .split(';')
            .map((part, i) => (
              <span key={i} className={i === 1 ? 'text-xs text-muted-foreground' : ''}>
                {i > 0 && <br />}
                {part}
              </span>
            ))}
        </p>
      </CardHeader>
      <CardContent className="flex flex-col flex-1">
        <div className="mb-6">
          <span className="text-4xl font-bold">
            {new Intl.NumberFormat(locale, {
              style: 'currency',
              currency: plan.currency,
              minimumFractionDigits: 0,
            }).format(plan.priceMonthly / 100)}
          </span>
          {plan.priceMonthly > 0 && (
            <span className="text-sm text-muted-foreground ml-1">{t('period_month')}</span>
          )}
        </div>

        <Separator className="mb-6" />

        <ul className="space-y-3 mb-8 flex-1">
          {plan.features.map((feature) => (
            <li key={feature} className="flex items-center gap-2 text-sm">
              <Check className="h-4 w-4 text-emerald-500 shrink-0" />
              <span>{getFeatureLabel(feature, t)}</span>
            </li>
          ))}
        </ul>

        {user && PLAN_ID_MAP[plan.key] ? (
          <CheckoutButton planId={PLAN_ID_MAP[plan.key]!} className="w-full">
            {t(CTA_KEY_MAP[plan.key] as any)}
          </CheckoutButton>
        ) : (
          <Button className="w-full" variant={popular ? 'default' : 'outline'} asChild>
            <Link href={user ? '/app' : '/register'}>{t(CTA_KEY_MAP[plan.key] as any)}</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export function PricingContent({ accountType }: { accountType: string }) {
  const t = useTranslations('PricingPage');
  const { user } = useAuth();

  const { data: plans, isLoading } = useApiQuery<PlanInfo[]>({
    queryKey: ['subscription-plans', 'active', accountType],
    url: `/api/v1/subscription-plans?for=${accountType}`,
  });

  const { data: currentPlan } = useApiQuery<PlanInfo>({
    queryKey: ['me', 'personal-plan'],
    url: '/api/v1/me/personal-plan',
    enabled: !!user,
  });

  const faqs = [
    { q: t('faq_q1'), a: t('faq_a1') },
    { q: t('faq_q2'), a: t('faq_a2') },
    { q: t('faq_q3'), a: t('faq_a3') },
    { q: t('faq_q4'), a: t('faq_a4') },
  ];

  const allFeatures = plans ? [...new Set(plans.flatMap((p) => p.features))].sort() : [];

  const visibleLimitKeys = SORTED_LIMIT_KEYS.filter((lk) => plans?.some((p) => lk in p.limits));

  return (
    <MainLayout>
      {/* HERO */}
      <section className="relative overflow-hidden text-center py-12 sm:py-20">
        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-emerald-500/10 via-primary/5 to-blue-500/10 dark:from-emerald-500/5 dark:via-primary/3 dark:to-blue-500/5" />
        <div className="absolute top-1/3 left-1/4 -z-10 h-64 w-64 rounded-full bg-emerald-500/15 blur-3xl" />
        <div className="absolute bottom-1/3 right-1/4 -z-10 h-64 w-64 rounded-full bg-blue-500/15 blur-3xl" />
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-4 text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto">
          {t('subtitle')}
        </p>
      </section>

      {/* PLAN CARDS */}
      <section className="py-8 sm:py-12">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6 max-w-7xl mx-auto">
            {(plans ?? []).map((plan) => (
              <PlanCard
                key={plan.key}
                plan={plan}
                isCurrentPlan={currentPlan?.key === plan.key}
                user={user}
                t={t}
                accountType={accountType}
              />
            ))}
          </div>
        )}
      </section>

      {/* COMPARISON TABLE */}
      {plans && plans.length > 0 && (
        <section className="py-12 sm:py-16">
          <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-center mb-8">
            {t('comparison_title')}
          </h2>
          <div className="overflow-x-auto max-w-7xl mx-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b">
                  <th className="text-left py-3 px-4 font-medium w-48">Feature</th>
                  {plans.map((p) => (
                    <th key={p.key} className="text-center py-3 px-4 font-medium">
                      {p.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {allFeatures.map((feature) => (
                  <tr key={feature} className="border-b border-border/50 even:bg-muted/20">
                    <td className="py-3 px-4 text-muted-foreground">
                      {getFeatureLabel(feature, t)}
                    </td>
                    {plans.map((p) => {
                      const included = p.features.includes(feature);
                      return (
                        <td key={p.key} className="text-center py-3 px-4">
                          {included ? (
                            <Check className="h-4 w-4 mx-auto text-emerald-500" />
                          ) : (
                            <Minus className="h-4 w-4 mx-auto text-muted-foreground/30" />
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
                {visibleLimitKeys.map((lk) => (
                  <tr key={lk} className="border-b border-border/50 even:bg-muted/20">
                    <td className="py-3 px-4 text-muted-foreground font-medium">
                      {t(`limit_${lk}`)}
                    </td>
                    {plans.map((p) => (
                      <td key={p.key} className="text-center py-3 px-4 text-sm tabular-nums">
                        {lk in p.limits ? formatLimitValue(lk, p.limits[lk], t) : '—'}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {/* FAQ */}
      <section className="py-12 sm:py-16 max-w-3xl mx-auto">
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-center mb-8">
          {t('faq_title')}
        </h2>
        <div className="space-y-6">
          {faqs.map(({ q, a }) => (
            <div key={q} className="border-b border-border/50 pb-6">
              <h3 className="font-semibold text-lg mb-2">{q}</h3>
              <p className="text-muted-foreground">{a}</p>
            </div>
          ))}
        </div>
      </section>

      {/* FINAL CTA */}
      <section className="py-12 text-center">
        <Button size="lg" asChild>
          <Link href="/register">
            {t('cta_free')} <Check className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </section>
    </MainLayout>
  );
}
