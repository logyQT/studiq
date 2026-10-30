'use client';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ChartContainer,
  ChartTooltipContent,
  Skeleton,
} from '@studiq/ui';
import { useTranslations } from 'next-intl';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Rectangle,
  type RectangleProps,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { InsightsError } from '@/components/stats/insights-error';
import { useStudentInsights } from '@/hooks/use-student-insights';
import { MIN_BUCKET_REVIEWS, retentionSample } from '@/lib/study-insights';

const DAYS = 30;

/** Smallest bar drawn for a real 0 %, in pixels. */
const MIN_BAR_PX = 4;

interface BarShapeProps extends RectangleProps {
  reviews?: number;
}

function RetentionBar(props: BarShapeProps) {
  if (!props.reviews) return null;
  const height = Math.max(props.height ?? 0, MIN_BAR_PX);
  return (
    <Rectangle {...props} height={height} y={(props.y ?? 0) - (height - (props.height ?? 0))} />
  );
}

/**
 * Retention curve: how often a card is answered correctly as a function of the time since it
 * was last reviewed. A healthy schedule keeps the bars high for longer gaps; a bar that drops
 * early means the intervals are too long for that material.
 */
export function RetentionCurveCard() {
  const t = useTranslations('StudentInsights');
  const { data, isLoading, isError, refetch } = useStudentInsights(DAYS);

  const buckets = data?.retention ?? [];
  const sample = retentionSample(buckets);
  const chart = buckets.map((b) => ({
    label: t(`bucket_${b.bucket}`),
    accuracy: b.accuracy,
    reviews: b.reviews,
    // A bucket with too few reviews is shown but drawn lighter in the tooltip note.
    thin: b.reviews > 0 && b.reviews < MIN_BUCKET_REVIEWS,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('retention_title')}</CardTitle>
        <CardDescription>{t('retention_desc', { days: DAYS })}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {isLoading ? (
          <Skeleton className="h-56 w-full" />
        ) : isError ? (
          <InsightsError onRetry={() => refetch()} />
        ) : sample === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t('retention_empty')}</p>
        ) : (
          <>
            <ChartContainer
              config={{ accuracy: { label: t('accuracy'), color: 'oklch(0.65 0.17 155)' } }}
              className="aspect-auto h-[220px] w-full"
            >
              <BarChart data={chart} margin={{ left: 0, right: 8, top: 8 }}>
                <CartesianGrid vertical={false} />
                <XAxis dataKey="label" tickLine={false} axisLine={false} tickMargin={8} />
                <YAxis domain={[0, 100]} tickLine={false} axisLine={false} width={36} unit="%" />
                <Tooltip
                  content={
                    // The shared tooltip renders no value when it is 0; a real 0 % bucket is
                    // drawn as a 4 px sliver and must still read "0 %".
                    <ChartTooltipContent formatter={(value) => `${value}%`} />
                  }
                />
                {/* A bucket without reviews is drawn as no bar at all; a real 0 % keeps a sliver. */}
                <Bar
                  dataKey="accuracy"
                  fill="var(--color-accuracy)"
                  radius={[6, 6, 0, 0]}
                  // recharts types a shape as always returning an element; this one may draw nothing.
                  shape={RetentionBar as never}
                />
              </BarChart>
            </ChartContainer>
            <p className="text-xs text-muted-foreground">
              {t('retention_axis')} {t('retention_sample', { count: sample })}
            </p>
            {chart.some((b) => b.thin) && (
              <p className="text-xs text-muted-foreground">
                {t('retention_thin', { min: MIN_BUCKET_REVIEWS })}
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
