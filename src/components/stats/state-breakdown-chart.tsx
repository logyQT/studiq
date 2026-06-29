'use client';

import { useTranslations } from 'next-intl';
import { PieChart, Pie, Cell, Tooltip, Legend, ResponsiveContainer } from 'recharts';

interface StateBreakdown {
  totalCards: number;
  neverPracticed: number;
  learning: number;
  review: number;
  relearning: number;
  leeched: number;
}

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
    { name: t('state_new'), value: states.neverPracticed, color: COLORS.neverPracticed },
    { name: t('state_learning'), value: states.learning, color: COLORS.learning },
    { name: t('state_review'), value: states.review, color: COLORS.review },
    { name: t('state_relearning'), value: states.relearning, color: COLORS.relearning },
    { name: t('state_leech'), value: states.leeched, color: COLORS.leeched },
  ].filter((d) => d.value > 0);

  return (
    <div className="min-h-[260px] flex items-center justify-center">
      <ResponsiveContainer width="100%" height={260}>
        <PieChart>
          <Tooltip />
          <Legend />
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
              <Cell key={index} fill={entry.color} />
            ))}
          </Pie>
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
