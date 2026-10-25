'use client';

import type { HealthStatusResponse } from '@studiq/server/models/health.model';
import { Card, CardContent } from '@studiq/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useApiQuery } from '@/hooks/use-api';
import { ApiError } from '@/lib/api';
import { statusKeys } from '@/lib/query-keys';

type StatusState = 'loading' | 'operational' | 'problem' | 'unavailable';

const DOT_CLASS_NAME: Record<StatusState, string> = {
  loading: 'bg-muted-foreground/50 animate-pulse',
  operational: 'bg-green-500',
  problem: 'bg-amber-500',
  unavailable: 'bg-red-500',
};

/**
 * Human-readable counterpart of `GET /api/v1/health` (#284). The endpoint stays a
 * machine-readable API; this page is the destination of the 404 page's
 * "Sprawdź status systemu" button and shows only the overall state plus when it
 * was checked — no uptime, environment or per-service details.
 */
export default function StatusPage() {
  const t = useTranslations('StatusPage');
  const locale = useLocale();

  const { data, error, isPending, errorUpdatedAt } = useApiQuery<HealthStatusResponse>({
    queryKey: statusKeys.health,
    url: '/api/v1/health',
    staleTime: 0,
    retry: false,
  });

  const state: StatusState = isPending
    ? 'loading'
    : data
      ? data.status === 'healthy'
        ? 'operational'
        : 'problem'
      : // `unhealthy` comes back as HTTP 503, so `apiGet` throws instead of
        // returning data; that is a real service issue, not a broken check.
        error instanceof ApiError && error.status === 503
        ? 'problem'
        : 'unavailable';

  const checkedAt =
    state === 'loading' ? null : data ? new Date(data.timestamp) : new Date(errorUpdatedAt);

  return (
    <div className="mx-auto max-w-xl py-12">
      <h1 className="text-4xl font-bold">{t('title')}</h1>

      <Card className="mt-8">
        <CardContent className="space-y-3">
          <div role="status" aria-live="polite" className="flex items-center gap-3">
            <span
              aria-hidden="true"
              className={`h-3 w-3 shrink-0 rounded-full ${DOT_CLASS_NAME[state]}`}
            />
            <span className="text-lg font-medium">{t(state)}</span>
          </div>

          {checkedAt ? (
            <p className="text-sm text-muted-foreground">
              {t('last_checked')}:{' '}
              {new Intl.DateTimeFormat(locale, {
                dateStyle: 'medium',
                timeStyle: 'short',
              }).format(checkedAt)}
            </p>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
