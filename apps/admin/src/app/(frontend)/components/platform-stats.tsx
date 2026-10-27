'use client';

import type {
  DailyStats,
  DailyStatsItem,
  PlatformStats as PlatformStatsData,
} from '@admin/server/models/platform-stats.model';
import { Button, Card, CardContent, CardDescription, CardHeader, CardTitle } from '@studiq/ui';
import { useQuery } from '@tanstack/react-query';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { QueryError } from '@/app/(frontend)/components/query-error';
import { apiGet } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';
import { barHeights, formatBytes, formatCount, total } from '@/lib/stats-format';

const RANGES = [30, 90] as const;
const SERIES = ['reviews', 'quizAttempts', 'studySessions', 'registrations'] as const;
type Series = (typeof SERIES)[number];

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-3xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      {hint && (
        <CardContent>
          <p className="text-xs text-muted-foreground">{hint}</p>
        </CardContent>
      )}
    </Card>
  );
}

/** Platform numbers and a daily activity chart for the admin home (#663). */
export function PlatformStats() {
  const t = useTranslations('AdminStats');
  const locale = useLocale();
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const [series, setSeries] = useState<Series>('reviews');

  const stats = useQuery({
    queryKey: queryKeys.stats.platform,
    queryFn: () => apiGet<PlatformStatsData>('/stats'),
  });
  const daily = useQuery({
    queryKey: queryKeys.stats.daily(days),
    queryFn: () => apiGet<DailyStats>(`/stats/daily?days=${days}`),
  });

  if (stats.isError) return <QueryError error={stats.error} />;

  const n = (value: number | undefined) => (value === undefined ? '…' : formatCount(value, locale));
  const s = stats.data;

  const items: DailyStatsItem[] = daily.data?.items ?? [];
  const values = items.map((item) => item[series]);
  const heights = barHeights(values);

  return (
    <section className="space-y-6" aria-label={t('title')}>
      <div>
        <h2 className="text-xl font-semibold tracking-tight">{t('title')}</h2>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label={t('users')}
          value={n(s?.users.total)}
          hint={
            s ? t('users_hint', { week: s.users.newLast7Days, trash: s.users.deleted }) : undefined
          }
        />
        <StatCard label={t('active_7')} value={n(s?.active.last7Days)} hint={t('active_hint')} />
        <StatCard label={t('active_30')} value={n(s?.active.last30Days)} hint={t('active_hint')} />
        <StatCard
          label={t('organizations')}
          value={n(s?.organizations)}
          hint={s ? t('groups_hint', { count: s.groups }) : undefined}
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label={t('decks')} value={n(s?.content.decks)} />
        <StatCard label={t('flashcards')} value={n(s?.content.flashcards)} />
        <StatCard
          label={t('questions')}
          value={n(s?.content.questions)}
          hint={s ? t('banks_hint', { count: s.content.questionBanks }) : undefined}
        />
        <StatCard
          label={t('storage')}
          value={s ? formatBytes(s.storage.bytes) : '…'}
          hint={s ? t('storage_hint', { count: s.storage.objects }) : undefined}
        />
      </div>

      <Card>
        <CardHeader className="gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <CardTitle className="text-base">{t('daily_title')}</CardTitle>
              <CardDescription>
                {t('daily_total', { count: formatCount(total(values), locale), days })}
              </CardDescription>
            </div>
            <div className="flex items-center gap-2">
              {RANGES.map((range) => (
                <Button
                  key={range}
                  size="sm"
                  variant={days === range ? 'default' : 'outline'}
                  onClick={() => setDays(range)}
                >
                  {t('range_days', { days: range })}
                </Button>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-2" role="group" aria-label={t('series_label')}>
            {SERIES.map((key) => (
              <Button
                key={key}
                size="sm"
                variant={series === key ? 'secondary' : 'ghost'}
                aria-pressed={series === key}
                onClick={() => setSeries(key)}
              >
                {t(`series_${key}`)}
              </Button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          {daily.isError ? (
            <QueryError error={daily.error} />
          ) : (
            <div
              className="flex h-40 items-end gap-px"
              role="img"
              aria-label={t('daily_aria', { series: t(`series_${series}`), days })}
            >
              {items.map((item, i) => (
                <div
                  key={item.date}
                  className="flex-1 rounded-t bg-primary/80 transition-[height]"
                  style={{ height: `${heights[i]}%`, minHeight: heights[i] > 0 ? 2 : 0 }}
                  title={`${item.date}: ${formatCount(values[i], locale)}`}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </section>
  );
}
