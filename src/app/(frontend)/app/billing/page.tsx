'use client';

import { Loader2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/components/providers/AuthProvider';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { useApiQuery } from '@/hooks/use-api';
import type { PlanInfo } from '@/server/services/subscription-plan.service';

const FEATURE_LABELS: Record<string, string> = {
  flashcards: 'flashcards',
  quiz: 'quiz',
  ai: 'ai',
  quiz_builder: 'quiz_builder',
  documents: 'documents',
  org_manage: 'org_manage',
  advanced_stats: 'advanced_stats',
};

export default function AppBillingPage() {
  const t = useTranslations('BillingPage');
  const { user } = useAuth();
  const { data: plan, isLoading } = useApiQuery<PlanInfo>({
    queryKey: ['me', 'plan'],
    url: '/api/v1/me/plan',
    enabled: !!user,
  });

  if (isLoading || !plan) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="size-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const isPremium = plan.key !== 'free';
  const isSchool = plan.key === 'school';
  const featureList = plan.features.length > 0 ? plan.features : ['flashcards', 'quiz'];

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground mt-1">{t('subtitle')}</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>{t('current_plan')}</CardTitle>
              <CardDescription>{plan.name}</CardDescription>
            </div>
            <Badge variant={isPremium ? 'default' : 'secondary'}>
              {isPremium ? t('active') : t('free')}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-baseline gap-2">
            <span className="text-3xl font-bold">
              {plan.priceMonthly > 0 ? `$${plan.priceMonthly}` : '$0'}
            </span>
            <span className="text-muted-foreground">
              {plan.priceMonthly > 0 ? '/month' : t('free_forever')}
            </span>
          </div>

          {isSchool && (
            <div className="flex items-center gap-2 rounded-lg bg-muted p-3 text-sm">
              <span>{t('access_via_classroom')}</span>
            </div>
          )}

          <Separator />

          <ul className="space-y-2">
            {featureList.map((feature) => (
              <li key={feature} className="flex items-center gap-2 text-sm">
                <span>{FEATURE_LABELS[feature] ?? feature}</span>
              </li>
            ))}
          </ul>

          {!isPremium && (
            <Button
              className="w-full"
              onClick={() => (window.location.href = '/checkout?plan_id=student_premium')}
            >
              {t('upgrade')}
            </Button>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
