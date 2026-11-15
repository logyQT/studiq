'use client';

import { CardDescription, CardHeader, CardTitle } from '@studiq/ui';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { PageHeading } from '@/components/shared/page-heading';

/** Page frame heading for every billing dashboard (student, educator, organization). */
export function BillingPageShell({ children }: { children: ReactNode }) {
  const t = useTranslations('BillingPage');

  return (
    <div className="max-w-2xl space-y-6">
      <PageHeading title={t('title')} subtitle={t('subtitle')} />
      {children}
    </div>
  );
}

interface CurrentPlanCardHeaderProps {
  description: ReactNode;
  /** Plan badge on the right, or its loading placeholder. */
  badge?: ReactNode;
}

/** "Current plan" card header; the card body differs per dashboard. */
export function CurrentPlanCardHeader({ description, badge }: CurrentPlanCardHeaderProps) {
  const t = useTranslations('BillingPage');

  return (
    <CardHeader>
      <div className="flex items-center justify-between">
        <div>
          <CardTitle>{t('current_plan')}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </div>
        {badge}
      </div>
    </CardHeader>
  );
}
