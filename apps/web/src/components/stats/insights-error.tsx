'use client';

import { Button } from '@studiq/ui';
import { useTranslations } from 'next-intl';

/** A failed read is an error with a retry, never an endless skeleton or "no data yet". */
export function InsightsError({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations('StudentInsights');

  return (
    <div role="alert" className="space-y-3 py-8 text-center">
      <p className="text-sm text-muted-foreground">{t('load_error')}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        {t('retry')}
      </Button>
    </div>
  );
}
