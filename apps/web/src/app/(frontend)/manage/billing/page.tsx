'use client';

import type { PlanInfo } from '@studiq/server/services/subscription-plan.service';
import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Skeleton,
} from '@studiq/ui';
import { Mail } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useAuth } from '@/components/providers/AuthProvider';
import { useApiQuery } from '@/hooks/use-api';

export default function ManageBillingPage() {
  const t = useTranslations('BillingPage');
  const { user } = useAuth();
  // /me/plan resolves the active organization's plan first (personal plan only as fallback).
  const { data: myPlan, isLoading: planLoading } = useApiQuery<PlanInfo>({
    queryKey: ['me', 'plan'],
    url: '/api/v1/me/plan',
    enabled: !!user,
  });
  const { data: plans, isLoading: plansLoading } = useApiQuery<PlanInfo[]>({
    queryKey: ['subscription-plans', 'active'],
    url: '/api/v1/subscription-plans',
  });
  const planName = myPlan
    ? (plans?.find((p) => p.key === myPlan.key)?.name ?? myPlan.name ?? myPlan.key)
    : null;

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
              <CardDescription>{t('org_plan')}</CardDescription>
            </div>
            {planLoading || plansLoading ? (
              <Skeleton className="h-6 w-24" />
            ) : planName ? (
              <Badge variant="secondary">{planName}</Badge>
            ) : null}
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{t('org_contact')}</p>
          <Button variant="outline" asChild>
            <a href="mailto:sales@studiq.app">
              <Mail className="size-4 mr-2" />
              {t('contact_sales')}
            </a>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
