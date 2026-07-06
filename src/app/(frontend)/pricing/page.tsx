'use client';

import { ArrowRight, Check, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { MainLayout } from '@/components';
import { CheckoutButton } from '@/components/pricing/checkout-button';
import { useAuth } from '@/components/providers/AuthProvider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useApiQuery } from '@/hooks/use-api';
import type { PlanInfo } from '@/server/services/subscription-plan.service';

const FEATURE_LABELS: Record<string, string> = {
  flashcards: 'Flashcards',
  quiz: 'Quizzes',
  ai: 'AI Assistant',
  quiz_builder: 'Quiz Builder',
  documents: 'Document Support',
  org_manage: 'Organization Management',
  advanced_stats: 'Advanced Statistics',
};

interface PlanCardProps {
  plan: PlanInfo;
  isCurrentPlan: boolean;
  user: unknown;
  t: (key: string) => string;
}

function getCtaText(planKey: string, t: (key: string) => string): string {
  switch (planKey) {
    case 'free':
      return t('free_cta');
    case 'premium':
      return t('premium_cta');
    case 'school':
      return t('university_cta');
    default:
      return t('free_cta');
  }
}

function PlanCard({ plan, isCurrentPlan, user, t }: PlanCardProps) {
  const planIdMap: Record<string, string | null> = {
    free: null,
    premium: 'student_premium',
    school: 'teacher_license',
  };

  const popular = plan.key === 'premium';

  return (
    <Card className={popular ? 'border-primary shadow-lg relative' : 'border-border/50'}>
      {popular && (
        <Badge className="absolute -top-3 left-1/2 -translate-x-1/2">{t('most_popular')}</Badge>
      )}
      {isCurrentPlan && (
        <Badge variant="secondary" className="absolute -top-3 right-4">
          Current
        </Badge>
      )}
      <CardHeader>
        <CardTitle className="text-xl">{plan.name}</CardTitle>
        <CardDescription>{plan.description}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="mb-6">
          <span className="text-4xl font-bold">
            {plan.priceMonthly > 0 ? `$${plan.priceMonthly / 100}` : '$0'}
          </span>
          {plan.priceMonthly > 0 && <p className="text-sm text-muted-foreground mt-1">/month</p>}
        </div>
        <ul className="space-y-3 mb-8">
          {plan.features.map((feature) => (
            <li key={feature} className="flex items-center gap-2 text-sm">
              <Check className="h-4 w-4 text-primary shrink-0" />
              {FEATURE_LABELS[feature] ?? feature}
            </li>
          ))}
        </ul>
        {user && planIdMap[plan.key] ? (
          <CheckoutButton
            planId={planIdMap[plan.key]!}
            variant={popular ? 'default' : 'outline'}
            className="w-full"
          >
            {getCtaText(plan.key, t)}
          </CheckoutButton>
        ) : (
          <Button className="w-full" variant={popular ? 'default' : 'outline'} asChild>
            <Link href={user ? '/app' : '/register'}>{getCtaText(plan.key, t)}</Link>
          </Button>
        )}
      </CardContent>
    </Card>
  );
}

export default function PricingPage() {
  const t = useTranslations('PricingPage');
  const { user } = useAuth();

  const { data: plans, isLoading } = useApiQuery<PlanInfo[]>({
    queryKey: ['subscription-plans', 'active'],
    url: '/api/v1/subscription-plans',
  });

  const { data: currentPlan } = useApiQuery<PlanInfo>({
    queryKey: ['me', 'plan'],
    url: '/api/v1/me/plan',
    enabled: !!user,
  });

  const faqs = [
    { q: t('faq_q1'), a: t('faq_a1') },
    { q: t('faq_q2'), a: t('faq_a2') },
    { q: t('faq_q3'), a: t('faq_a3') },
    { q: t('faq_q4'), a: t('faq_a4') },
  ];

  return (
    <MainLayout>
      <section className="text-center py-12 sm:py-20">
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-4 text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto">
          {t('subtitle')}
        </p>
      </section>

      <section className="py-8 sm:py-12">
        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="size-6 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {(plans ?? []).map((plan) => (
              <PlanCard
                key={plan.key}
                plan={plan}
                isCurrentPlan={currentPlan?.key === plan.key}
                user={user}
                t={t}
              />
            ))}
          </div>
        )}
      </section>

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

      <section className="py-12 text-center">
        <Button size="lg" asChild>
          <Link href="/register">
            {t('free_cta')} <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </section>
    </MainLayout>
  );
}
