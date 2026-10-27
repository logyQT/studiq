'use client';

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  ChartContainer,
  ChartTooltipContent,
  Skeleton,
} from '@studiq/ui';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts';
import { InsightsError } from '@/components/stats/insights-error';
import { useStudentInsights } from '@/hooks/use-student-insights';
import { busiestWeekday, splitDuration, weekdayNames } from '@/lib/study-insights';

const RANGES = [7, 30, 90] as const;

/** Time spent studying: totals, the average active day and which weekdays are busiest. */
export function StudyTimeCard() {
  const t = useTranslations('StudentInsights');
  const locale = useLocale();
  const [days, setDays] = useState<(typeof RANGES)[number]>(30);
  const { data, isLoading, isError, refetch } = useStudentInsights(days);

  const duration = (ms: number) => {
    const { hours, minutes } = splitDuration(ms);
    if (hours === 0 && minutes === 0 && ms > 0) return t('duration_lt_min');
    if (hours === 0) return t('duration_min', { minutes });
    return minutes === 0 ? t('duration_h', { hours }) : t('duration_h_min', { hours, minutes });
  };

  const time = data?.studyTime;
  const names = weekdayNames(locale);
  const longNames = weekdayNames(locale, 'long');
  const chart = (time?.byWeekday ?? []).map((ms, i) => ({
    day: names[i],
    minutes: Math.round(ms / 60000),
  }));
  const busiest = time ? busiestWeekday(time.byWeekday) : null;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-3 space-y-0">
        <CardTitle className="text-base">{t('study_time_title')}</CardTitle>
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
      </CardHeader>
      <CardContent className="space-y-6">
        {isLoading ? (
          <Skeleton className="h-56 w-full" />
        ) : isError || !time ? (
          <InsightsError onRetry={() => refetch()} />
        ) : time.totalMs === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t('study_time_empty')}</p>
        ) : (
          <>
            <dl className="grid gap-4 sm:grid-cols-3">
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t('total')}
                </dt>
                <dd className="text-2xl font-bold tabular-nums">{duration(time.totalMs)}</dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t('avg_per_active_day')}
                </dt>
                <dd className="text-2xl font-bold tabular-nums">
                  {duration(time.avgMsPerActiveDay)}
                </dd>
              </div>
              <div>
                <dt className="text-xs uppercase tracking-wide text-muted-foreground">
                  {t('active_days')}
                </dt>
                <dd className="text-2xl font-bold tabular-nums">{time.activeDays}</dd>
              </div>
            </dl>

            <div className="space-y-2">
              <p className="text-sm font-medium">{t('by_weekday')}</p>
              <ChartContainer
                config={{ minutes: { label: t('minutes'), color: 'oklch(0.546 0.245 265)' } }}
                className="aspect-auto h-[200px] w-full"
              >
                <BarChart data={chart} margin={{ left: 0, right: 8, top: 8 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="day" tickLine={false} axisLine={false} tickMargin={8} />
                  <YAxis
                    tickLine={false}
                    axisLine={false}
                    width={52}
                    allowDecimals={false}
                    unit=" min"
                  />
                  <Tooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="minutes" fill="var(--color-minutes)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ChartContainer>
              <p className="text-xs text-muted-foreground">{t('study_time_note')}</p>
              {busiest !== null && (
                <p className="text-sm text-muted-foreground">
                  {t('busiest_day', { day: longNames[busiest] })}
                </p>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
