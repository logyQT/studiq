'use client';

import { Button } from '@studiq/ui';
import { useTranslations } from 'next-intl';

/**
 * A failed read is an error with a retry, never the "nothing to do" copy: a 500 must not look
 * like an empty dashboard.
 */
export function CardError({ onRetry }: { onRetry: () => void }) {
  const t = useTranslations('AppDashboard');

  return (
    <div role="alert" className="space-y-3 py-4 text-center">
      <p className="text-sm text-muted-foreground">{t('load_error')}</p>
      <Button variant="outline" size="sm" onClick={onRetry}>
        {t('retry')}
      </Button>
    </div>
  );
}
