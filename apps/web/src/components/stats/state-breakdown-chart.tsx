'use client';

import type { StateBreakdown } from '@studiq/server/models/flashcard-practice.model';
import { ChartContainer, ChartTooltipContent } from '@studiq/ui';
import { useTranslations } from 'next-intl';
import { Cell, Legend, Pie, PieChart, Tooltip } from 'recharts';

interface StateBreakdownChartProps {
  states: StateBreakdown;
}

/*
 * Each state owns one ramp step. Leeched takes `--chart-6`, the ramp's only red:
 * the state that needs attention must read as a problem, and `--destructive` is a
 * UI semantic (errors, danger actions) rather than a data-series colour.
 */
const COLORS = {
  neverPracticed: 'var(--chart-2)',
  learning: 'var(--chart-1)',
  review: 'var(--chart-5)',
  relearning: 'var(--chart-3)',
  leeched: 'var(--chart-6)',
};

/** Recharts legend label renderer — hoisted so the reference stays stable across renders. */
function renderLegendValue(value: string) {
  return <span className="text-foreground">{value}</span>;
}

export function StateBreakdownChart({ states }: StateBreakdownChartProps) {
  const t = useTranslations('AppStatsPage');

  const data = [
    { name: t('state_new'), value: states.neverPracticed, fill: COLORS.neverPracticed },
    { name: t('state_learning'), value: states.learning, fill: COLORS.learning },
    { name: t('state_review'), value: states.review, fill: COLORS.review },
    { name: t('state_relearning'), value: states.relearning, fill: COLORS.relearning },
    { name: t('state_leech'), value: states.leeched, fill: COLORS.leeched },
  ].filter((d) => d.value > 0);

  const total = data.reduce((sum, d) => sum + d.value, 0);

  if (total === 0) {
    return (
      <div className="flex h-[260px] items-center justify-center px-6">
        <p className="text-muted-foreground text-center text-sm">{t('state_breakdown_empty')}</p>
      </div>
    );
  }

  return (
    // Slices carry their own `fill` and the tooltip labels come from the translated
    // slice `name`, so no config keys are needed (the chart context still is).
    <ChartContainer config={{}} className="aspect-auto h-[260px] w-full">
      <PieChart>
        <Tooltip content={<ChartTooltipContent />} />
        {/* Recharts sets the label span's colour inline to the slice colour (entry.fill).
            The inner span restores a readable token; the icon keeps the slice colour. */}
        <Legend formatter={renderLegendValue} />
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={60}
          outerRadius={100}
          paddingAngle={2}
          dataKey="value"
        >
          {data.map((entry, index) => (
            <Cell key={index} fill={entry.fill} />
          ))}
        </Pie>
      </PieChart>
    </ChartContainer>
  );
}
