'use client';

import { Button } from '@studiq/ui';
import { useTranslations } from 'next-intl';

/** A failed read is an error with a retry, never "no groups" or "no activity". */
export function CardError({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations('EduOverviewPage');

  return (
    <div role="alert" className="space-y-3 py-8 text-center">
      <p className="text-sm text-muted-foreground">{t('load_error')}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        {t('retry')}
      </Button>
    </div>
  );
}
