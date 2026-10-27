'use client';

import type { HealthStatusResponse } from '@studiq/server/models/health.model';
import { Card, CardContent } from '@studiq/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useApiQuery } from '@/hooks/use-api';
import { deriveHealthStatusView, type HealthStatusState } from '@/lib/health-status';
import { statusKeys } from '@/lib/query-keys';

const DOT_CLASS_NAME: Record<HealthStatusState, string> = {
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

  // Error-first: a failed refetch keeps the previous `data`, and showing that
  // stale state would hide an outage (#284 review 1).
  const { state, checkedAt } = deriveHealthStatusView({ isPending, error, errorUpdatedAt, data });

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
