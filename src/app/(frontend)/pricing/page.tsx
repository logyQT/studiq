'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { MainLayout } from '@/components';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Check, ArrowRight } from 'lucide-react';

export default function PricingPage() {
  const t = useTranslations('PricingPage');

  const plans = [
    {
      name: t('free_name'),
      price: t('free_price'),
      period: t('free_period'),
      desc: t('free_desc'),
      features: [
        t('free_features_1'),
        t('free_features_2'),
        t('free_features_3'),
        t('free_features_4'),
      ],
      cta: t('free_cta'),
      href: '/register',
      variant: 'outline' as const,
    },
    {
      name: t('premium_name'),
      price: t('premium_price'),
      period: t('premium_period'),
      desc: t('premium_desc'),
      features: [
        t('premium_features_1'),
        t('premium_features_2'),
        t('premium_features_3'),
        t('premium_features_4'),
        t('premium_features_5'),
        t('premium_features_6'),
      ],
      cta: t('premium_cta'),
      href: '/register',
      variant: 'default' as const,
      popular: true,
    },
    {
      name: t('university_name'),
      price: t('university_price'),
      period: t('university_period'),
      desc: t('university_desc'),
      features: [
        t('university_features_1'),
        t('university_features_2'),
        t('university_features_3'),
        t('university_features_4'),
        t('university_features_5'),
        t('university_features_6'),
        t('university_features_7'),
      ],
      cta: t('university_cta'),
      href: '/register',
      variant: 'outline' as const,
    },
  ];

  const faqs = [
    { q: t('faq_q1'), a: t('faq_a1') },
    { q: t('faq_q2'), a: t('faq_a2') },
    { q: t('faq_q3'), a: t('faq_a3') },
    { q: t('faq_q4'), a: t('faq_a4') },
  ];

  return (
    <MainLayout>
      {/* HERO */}
      <section className="text-center py-12 sm:py-20">
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-4 text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto">
          {t('subtitle')}
        </p>
      </section>

      {/* PRICING CARDS */}
      <section className="py-8 sm:py-12">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 max-w-5xl mx-auto">
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
                <CardDescription>{plan.desc}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="mb-6">
                  <span className="text-4xl font-bold">{plan.price}</span>
                  {plan.period && (
                    <p className="text-sm text-muted-foreground mt-1">{plan.period}</p>
                  )}
                </div>
                <ul className="space-y-3 mb-8">
                  {plan.features.map((f) => (
                    <li key={f} className="flex items-center gap-2 text-sm">
                      <Check className="h-4 w-4 text-primary shrink-0" />
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
      </section>

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

      {/* CTA */}
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
