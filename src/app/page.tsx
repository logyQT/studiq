'use client';

import {
  ArrowRight,
  BarChart3,
  BookOpen,
  Brain,
  FileText,
  Sparkles,
  Target,
  TrendingUp,
  Zap,
} from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { MainLayout } from '@/components';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

const iconColors = [
  { bg: 'bg-blue-500/10', text: 'text-blue-500' },
  { bg: 'bg-purple-500/10', text: 'text-purple-500' },
  { bg: 'bg-emerald-500/10', text: 'text-emerald-500' },
  { bg: 'bg-amber-500/10', text: 'text-amber-500' },
];

const aiIconColors = [
  { bg: 'bg-violet-500/10', text: 'text-violet-500' },
  { bg: 'bg-orange-500/10', text: 'text-orange-500' },
  { bg: 'bg-rose-500/10', text: 'text-rose-500' },
];

export default function HomePage() {
  const t = useTranslations('LandingPage');

  const freeFeatures = [
    { icon: FileText, title: t('free_questions'), desc: t('free_questions_desc') },
    { icon: Brain, title: t('free_flashcards'), desc: t('free_flashcards_desc') },
    { icon: BookOpen, title: t('free_quizzes'), desc: t('free_quizzes_desc') },
    { icon: BarChart3, title: t('free_stats'), desc: t('free_stats_desc') },
  ];

  const aiFeatures = [
    { icon: Sparkles, title: t('ai_generate_questions'), desc: t('ai_generate_questions_desc') },
    { icon: Zap, title: t('ai_generate_flashcards'), desc: t('ai_generate_flashcards_desc') },
    { icon: Target, title: t('ai_exam_sim'), desc: t('ai_exam_sim_desc') },
  ];

  const plans = [
    {
      name: t('pricing_free_name'),
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
    <MainLayout>
      {/* HERO */}
      <section className="relative overflow-hidden py-20 sm:py-32">
        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-violet-500/10 via-primary/5 to-cyan-500/10 dark:from-violet-500/5 dark:via-primary/3 dark:to-cyan-500/5" />
        <div className="absolute top-1/4 left-1/4 -z-10 h-72 w-72 rounded-full bg-violet-500/20 blur-3xl" />
        <div className="absolute bottom-1/4 right-1/4 -z-10 h-72 w-72 rounded-full bg-cyan-500/20 blur-3xl" />
        <div className="mx-auto max-w-4xl text-center">
          <Badge variant="secondary" className="mb-6">
            AI-Powered Learning Platform
          </Badge>
          <h1 className="text-4xl sm:text-6xl font-bold tracking-tight">{t('hero_title')}</h1>
          <p className="mt-6 text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto">
            {t('hero_subtitle')}
          </p>
          <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
            <Button size="lg" asChild>
              <Link href="/register">{t('cta_start')}</Link>
            </Button>
            <Button size="lg" variant="outline" asChild>
              <Link href="/features">
                {t('cta_features')} <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>

      {/* FREE FEATURES */}
      <section className="py-16 sm:py-24">
        <div className="mx-auto max-w-5xl">
          <div className="text-center mb-12">
            <Badge variant="secondary" className="mb-4">
              Free Forever
            </Badge>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">{t('free_title')}</h2>
            <p className="mt-4 text-lg text-muted-foreground">{t('free_desc')}</p>
          </div>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {freeFeatures.map(({ icon: Icon, title, desc }, i) => (
              <Card key={title} className="border-border/50">
                <CardHeader>
                  <div
                    className={`h-10 w-10 rounded-lg ${iconColors[i].bg} flex items-center justify-center mb-2`}
                  >
                    <Icon className={`h-5 w-5 ${iconColors[i].text}`} />
                  </div>
                  <CardTitle className="text-lg">{title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* AI FEATURES */}
      <section className="py-16 sm:py-24 bg-muted/30">
        <div className="mx-auto max-w-5xl">
          <div className="text-center mb-12">
            <Badge className="mb-4">Premium & University</Badge>
            <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">{t('ai_title')}</h2>
            <p className="mt-4 text-lg text-muted-foreground">{t('ai_desc')}</p>
          </div>
          <div className="grid sm:grid-cols-3 gap-6">
            {aiFeatures.map(({ icon: Icon, title, desc }, i) => (
              <Card key={title} className="border-border/50">
                <CardHeader>
                  <div
                    className={`h-10 w-10 rounded-lg ${aiIconColors[i].bg} flex items-center justify-center mb-2`}
                  >
                    <Icon className={`h-5 w-5 ${aiIconColors[i].text}`} />
                  </div>
                  <CardTitle className="text-lg">{title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{desc}</p>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      </section>

      {/* PRICING PREVIEW */}
      <section className="py-16 sm:py-24">
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
                        <TrendingUp className="h-4 w-4 text-primary shrink-0" />
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
                {t('pricing_cta')} <ArrowRight className="ml-1 h-4 w-4" />
              </Link>
            </Button>
          </div>
        </div>
      </section>
    </MainLayout>
  );
}
