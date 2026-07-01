'use client';

import { ArrowRight, TrendingUp } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

export function Pricing() {
  const t = useTranslations('LandingPage');

  const plans = [
    {
      name: 'Free',
      price: '$0',
      period: '/forever',
      desc: t('pricing_free_desc'),
      features: [t('free_questions'), t('free_flashcards'), t('free_quizzes'), t('free_stats')],
      cta: t('cta_start'),
      href: '/register',
      variant: 'outline' as const,
    },
    {
      name: 'Premium',
      price: '$9.99',
      period: '/month',
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
      cta: 'Start Premium Trial',
      href: '/register',
      variant: 'default' as const,
      popular: true,
    },
    {
      name: 'University',
      price: 'Custom',
      period: '',
      desc: t('pricing_university_desc'),
      features: [
        'Everything in Premium',
        'Organization management',
        'Role-based access',
        'Bulk invitations',
        'University analytics',
        'Dedicated support',
      ],
      cta: 'Contact Sales',
      href: '/pricing',
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
              key={plan.name}
              className={plan.popular ? 'border-primary shadow-lg relative' : 'border-border/50'}
            >
              {plan.popular && (
                <Badge className="absolute -top-3 left-1/2 -translate-x-1/2">Most Popular</Badge>
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
