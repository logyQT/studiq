'use client';

import type { StateBreakdown } from '@studiq/server/models/flashcard-practice.model';
import { ChartContainer, ChartTooltipContent } from '@studiq/ui';
import { useTranslations } from 'next-intl';
import { Cell, Legend, Pie, PieChart, Tooltip } from 'recharts';

interface StateBreakdownChartProps {
  states: StateBreakdown;
}

const COLORS = {
  neverPracticed: 'oklch(0.52 0.03 265)',
  learning: 'oklch(0.546 0.245 265)',
  review: 'oklch(0.65 0.17 155)',
  relearning: 'oklch(0.75 0.15 75)',
  leeched: 'oklch(0.577 0.245 27.325)',
};

export function StateBreakdownChart({ states }: StateBreakdownChartProps) {
  const t = useTranslations('AppStatsPage');

  const data = [
    { name: t('state_new'), value: states.neverPracticed, fill: COLORS.neverPracticed },
    { name: t('state_learning'), value: states.learning, fill: COLORS.learning },
    { name: t('state_review'), value: states.review, fill: COLORS.review },
    { name: t('state_relearning'), value: states.relearning, fill: COLORS.relearning },
    { name: t('state_leech'), value: states.leeched, fill: COLORS.leeched },
  ].filter((d) => d.value > 0);

  return (
    // Slices carry their own `fill` and the tooltip labels come from the translated
    // slice `name`, so no config keys are needed (the chart context still is).
    <ChartContainer config={{}} className="aspect-auto h-[260px] w-full">
      <PieChart>
        <Tooltip content={<ChartTooltipContent />} />
        {/* Recharts sets the label span's colour inline to the slice colour (entry.fill).
            The inner span restores a readable token; the icon keeps the slice colour. */}
        <Legend formatter={(value) => <span className="text-foreground">{value}</span>} />
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
