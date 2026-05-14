'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { MainLayout } from '@/components';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  FileText,
  Brain,
  BookOpen,
  BarChart3,
  Sparkles,
  Zap,
  Target,
  TrendingUp,
  Building2,
  Mail,
  GraduationCap,
  ArrowRight,
  Check,
} from 'lucide-react';

const FREE = 'free';
const PREMIUM = 'premium';
const UNIVERSITY = 'university';

const planColors: Record<string, { bg: string; text: string }> = {
  free: { bg: 'bg-blue-500/10', text: 'text-blue-500' },
  premium: { bg: 'bg-violet-500/10', text: 'text-violet-500' },
  university: { bg: 'bg-emerald-500/10', text: 'text-emerald-500' },
};

export default function FeaturesPage() {
  const t = useTranslations('FeaturesPage');

  const features = [
    { icon: FileText, title: t('manual_questions'), desc: t('manual_questions_desc'), plan: FREE },
    { icon: Brain, title: t('flashcard_practice'), desc: t('flashcard_practice_desc'), plan: FREE },
    { icon: BookOpen, title: t('quiz_taking'), desc: t('quiz_taking_desc'), plan: FREE },
    { icon: BarChart3, title: t('basic_stats'), desc: t('basic_stats_desc'), plan: FREE },
    { icon: Sparkles, title: t('ai_questions'), desc: t('ai_questions_desc'), plan: PREMIUM },
    { icon: Zap, title: t('ai_flashcards'), desc: t('ai_flashcards_desc'), plan: PREMIUM },
    { icon: Target, title: t('ai_exam'), desc: t('ai_exam_desc'), plan: PREMIUM },
    { icon: TrendingUp, title: t('advanced_stats'), desc: t('advanced_stats_desc'), plan: PREMIUM },
    {
      icon: Building2,
      title: t('org_management'),
      desc: t('org_management_desc'),
      plan: UNIVERSITY,
    },
    { icon: Mail, title: t('bulk_invites'), desc: t('bulk_invites_desc'), plan: UNIVERSITY },
    {
      icon: GraduationCap,
      title: t('uni_analytics'),
      desc: t('uni_analytics_desc'),
      plan: UNIVERSITY,
    },
  ];

  const planBadge = (plan: string) => {
    if (plan === FREE) return <Badge variant="secondary">{t('manual_questions_plan')}</Badge>;
    if (plan === PREMIUM) return <Badge className="bg-violet-500">{t('ai_questions_plan')}</Badge>;
    return <Badge variant="outline">{t('org_management_plan')}</Badge>;
  };

  const comparisonRows = [
    { feature: t('manual_questions'), free: true, premium: true, university: true },
    { feature: t('flashcard_practice'), free: true, premium: true, university: true },
    { feature: t('quiz_taking'), free: true, premium: true, university: true },
    { feature: t('basic_stats'), free: true, premium: true, university: true },
    { feature: t('ai_questions'), free: false, premium: true, university: true },
    { feature: t('ai_flashcards'), free: false, premium: true, university: true },
    { feature: t('ai_exam'), free: false, premium: true, university: true },
    { feature: t('advanced_stats'), free: false, premium: true, university: true },
    { feature: t('org_management'), free: false, premium: false, university: true },
    { feature: t('bulk_invites'), free: false, premium: false, university: true },
    { feature: t('uni_analytics'), free: false, premium: false, university: true },
  ];

  return (
    <MainLayout>
      {/* HERO */}
      <section className="relative overflow-hidden text-center py-12 sm:py-20">
        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-blue-500/10 via-violet-500/5 to-emerald-500/10 dark:from-blue-500/5 dark:via-violet-500/3 dark:to-emerald-500/5" />
        <div className="absolute top-1/3 left-1/4 -z-10 h-64 w-64 rounded-full bg-blue-500/15 blur-3xl" />
        <div className="absolute bottom-1/3 right-1/4 -z-10 h-64 w-64 rounded-full bg-emerald-500/15 blur-3xl" />
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-4 text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto">
          {t('subtitle')}
        </p>
      </section>

      {/* FEATURES GRID */}
      <section className="py-12">
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map(({ icon: Icon, title, desc, plan }) => {
            const colors = planColors[plan];
            return (
              <Card key={title} className="border-border/50">
                <CardHeader>
                  <div className="flex items-center gap-2 mb-2">
                    <div
                      className={`h-9 w-9 rounded-lg ${colors.bg} flex items-center justify-center`}
                    >
                      <Icon className={`h-5 w-5 ${colors.text}`} />
                    </div>
                    {planBadge(plan)}
                  </div>
                  <CardTitle className="text-lg">{title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{desc}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </section>

      {/* COMPARISON TABLE */}
      <section className="py-12 sm:py-16">
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight text-center mb-8">
          {t('comparison_title')}
        </h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b">
                <th className="text-left py-3 px-4 font-medium">{t('comparison_feature')}</th>
                <th className="text-center py-3 px-4 font-medium">{t('comparison_free')}</th>
                <th className="text-center py-3 px-4 font-medium">{t('comparison_premium')}</th>
                <th className="text-center py-3 px-4 font-medium">{t('comparison_university')}</th>
              </tr>
            </thead>
            <tbody>
              {comparisonRows.map(({ feature, free, premium, university }) => (
                <tr key={feature} className="border-b border-border/50">
                  <td className="py-3 px-4 text-muted-foreground">{feature}</td>
                  <td className="text-center py-3 px-4">
                    {free ? (
                      <Check className="h-4 w-4 mx-auto text-primary" />
                    ) : (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </td>
                  <td className="text-center py-3 px-4">
                    {premium ? (
                      <Check className="h-4 w-4 mx-auto text-violet-500" />
                    ) : (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </td>
                  <td className="text-center py-3 px-4">
                    {university ? (
                      <Check className="h-4 w-4 mx-auto text-emerald-500" />
                    ) : (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16 text-center">
        <h2 className="text-2xl sm:text-3xl font-bold tracking-tight">{t('cta_title')}</h2>
        <p className="mt-4 text-lg text-muted-foreground">{t('cta_desc')}</p>
        <Button size="lg" className="mt-8" asChild>
          <Link href="/register">
            {t('cta_button')} <ArrowRight className="ml-2 h-4 w-4" />
          </Link>
        </Button>
      </section>
    </MainLayout>
  );
}
