'use client';

import { useTranslations } from 'next-intl';
import { PlanLockedCard } from '@/components/shared/plan-locked-card';

/**
 * The `stats.insights` plan card in place of a gated dashboard card's body
 * (phase 5d): the gated read is disabled while unentitled, so the card shows
 * this instead of an error state or a control whose API would 403.
 */
export function CardLocked() {
  const t = useTranslations('EduOverviewPage');

  return (
    <PlanLockedCard
      title={t('locked_title')}
      description={t('locked_desc')}
      cta={t('locked_cta')}
    />
  );
}
