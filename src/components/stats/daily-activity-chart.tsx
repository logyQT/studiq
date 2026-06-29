'use client';

import { useTranslations } from 'next-intl';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ReferenceLine,
  Brush,
  ResponsiveContainer,
} from 'recharts';
import { ChartContainer, ChartTooltipContent } from '@/components/ui/chart';
import { Button } from '@/components/ui/button';

interface DailyActivity {
  date: string;
  reviews_count: number;
  reviews_correct: number;
}

interface DailyActivityChartProps {
  data: DailyActivity[];
  goal: number;
  range: string;
  onRangeChange: (range: string) => void;
}

const RANGES = ['7d', '30d', '1y'] as const;

export function DailyActivityChart({ data, goal, range, onRangeChange }: DailyActivityChartProps) {
  const t = useTranslations('AppStatsPage');

  const chartData = data.map((d) => ({
    date: d.date.slice(5),
    reviews: d.reviews_count,
    correct: d.reviews_correct,
  }));

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        {RANGES.map((r) => (
          <Button
            key={r}
            variant={range === r ? 'default' : 'outline'}
            size="sm"
            onClick={() => onRangeChange(r)}
          >
            {t(`range_${r}`)}
          </Button>
        ))}
      </div>

      <ChartContainer
        config={{
          reviews: { label: t('reviews'), color: 'oklch(0.546 0.245 265)' },
          correct: { label: t('correct'), color: 'oklch(0.65 0.17 155)' },
        }}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border" />
            <XAxis dataKey="date" fontSize={12} tickLine={false} axisLine={false} />
            <YAxis fontSize={12} tickLine={false} axisLine={false} allowDecimals={false} />
            <Tooltip content={<ChartTooltipContent />} />
            {goal > 0 && (
              <ReferenceLine
                y={goal}
                stroke="hsl(var(--destructive))"
                strokeDasharray="4 4"
                label={{ value: t('daily_goal'), position: 'insideTopRight', fill: 'hsl(var(--destructive))', fontSize: 11 }}
              />
            )}
            <Brush dataKey="date" height={30} stroke="oklch(0.546 0.245 265)" />
            <Bar dataKey="reviews" fill="var(--color-reviews)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </ChartContainer>
    </div>
  );
}
