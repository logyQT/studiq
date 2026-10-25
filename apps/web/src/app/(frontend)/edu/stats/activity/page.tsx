'use client';

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltipContent,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@studiq/ui';
import { BookOpen, ClipboardList, Target, TrendingDown, TrendingUp, Users } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { Bar, CartesianGrid, ComposedChart, Line, Tooltip, XAxis, YAxis } from 'recharts';

import { formatDate } from '@/lib/datetime';
import { hasTeacherActivity } from '@/lib/stats';

type StudentRow = {
  id: string;
  name: string;
  email: string;
  lastActive: string | null;
  practices7d: number;
  accuracy7d: number | null;
  quizzes7d: number;
  status: 'active' | 'recent' | 'check_in';
};

type DailyPoint = {
  date: string;
  reviews: number;
  activeStudents: number;
};

type MetricComp = { current: number; previous: number };

type ActivityData = {
  summary: {
    activeStudents: MetricComp;
    totalPractices: MetricComp;
    avgAccuracy: MetricComp;
    totalQuizzes: MetricComp;
  };
  dailyActivity: DailyPoint[];
  students: StudentRow[];
};

function TrendIndicator({ current, previous }: MetricComp) {
  const t = useTranslations('TeacherActivityPage');
  if (previous === 0) {
    return <span className="text-xs text-muted-foreground ml-1">{t('no_previous_data')}</span>;
  }
  const diff = current - previous;
  const pct = Math.round((diff / previous) * 100);
  if (pct === 0) return <span className="text-xs text-muted-foreground ml-1">→ 0%</span>;
  return (
    <span
      className={`text-xs ml-1 flex items-center gap-0.5 ${pct > 0 ? 'text-green-600' : 'text-red-500'}`}
    >
      {pct > 0 ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
      {Math.abs(pct)}%
    </span>
  );
}

const RANGES = ['7d', '30d', '90d'] as const;

/**
 * Parses a date-only `YYYY-MM-DD` chart key as a **local** midnight. `new Date('2026-10-22')`
 * would parse as UTC, shifting the rendered day in negative-offset time zones (#251).
 */
const parseDay = (value: string): Date => {
  const [year, month, day] = value.slice(0, 10).split('-').map(Number);
  return new Date(year, month - 1, day);
};

export default function TeacherActivityPage() {
  const t = useTranslations('TeacherActivityPage');
  const locale = useLocale();
  // X axis: day + month only, in the app locale (pl 22.10 / en 10/22).
  const formatDayTick = (value: string): string =>
    parseDay(value).toLocaleDateString(locale, { month: 'numeric', day: 'numeric' });
  const formatLastActive = (dateStr: string | null): string => {
    if (!dateStr) return '—';
    const diff = Date.now() - new Date(dateStr).getTime();
    const hours = Math.floor(diff / (1000 * 60 * 60));
    if (hours < 1) return t('today');
    if (hours < 24) return t('hours_ago', { hours });
    const days = Math.floor(hours / 24);
    return t('days_ago', { days });
  };
  const [range, setRange] = useState<'7d' | '30d' | '90d'>('7d');
  const [data, setData] = useState<ActivityData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/stats/teacher/activity?range=${range}`);
      const json = await res.json();
      setData(res.ok && json.success ? json.data : null);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const summaryCards = data
    ? [
        {
          title: t('active_students'),
          value: `${data.summary.activeStudents.current}`,
          icon: Users,
          metric: data.summary.activeStudents,
        },
        {
          title: t('total_practices'),
          value: data.summary.totalPractices.current.toLocaleString(),
          icon: BookOpen,
          metric: data.summary.totalPractices,
        },
        {
          title: t('avg_accuracy'),
          value: `${data.summary.avgAccuracy.current}%`,
          icon: Target,
          metric: data.summary.avgAccuracy,
        },
        {
          title: t('quizzes_taken'),
          value: data.summary.totalQuizzes.current.toString(),
          icon: ClipboardList,
          metric: data.summary.totalQuizzes,
        },
      ]
    : [];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground mt-1">{t('description')}</p>
        </div>
        <div className="flex gap-1 bg-muted rounded-lg p-1">
          {RANGES.map((r) => (
            <Button
              key={r}
              variant={range === r ? 'default' : 'ghost'}
              size="sm"
              onClick={() => setRange(r)}
              className="text-xs"
            >
              {t(`range_${r}`)}
            </Button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="space-y-4">
          <div className="grid gap-4 md:grid-cols-4">
            {[1, 2, 3, 4].map((i) => (
              <Skeleton key={i} className="h-28 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-72 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      ) : !data || !hasTeacherActivity(data) ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            {t('no_data')}
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            {summaryCards.map((card) => (
              <Card key={card.title}>
                <CardHeader className="pb-2 flex flex-row items-center justify-between">
                  <CardTitle className="text-sm text-muted-foreground font-medium">
                    {card.title}
                  </CardTitle>
                  <card.icon className="size-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="flex items-baseline gap-2">
                    <p className="text-3xl font-bold">{card.value}</p>
                    <TrendIndicator current={card.metric.current} previous={card.metric.previous} />
                  </div>
                  {card.metric.previous !== 0 && (
                    <p className="text-xs text-muted-foreground mt-1">{t('vs_previous')}</p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t('daily_activity')}</CardTitle>
              <CardDescription>{t(`range_${range}`)}</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer
                config={{
                  reviews: { label: t('reviews'), color: 'var(--primary)' },
                  activeStudents: {
                    label: t('active_students_chart'),
                    // Dark `--destructive` is 2.17:1 on the dark card; the readable red of the
                    // same family keeps the line above WCAG 1.4.11 (10.48:1).
                    theme: {
                      light: 'var(--destructive)',
                      dark: 'var(--destructive-foreground)',
                    },
                  },
                }}
                className="aspect-auto h-72 w-full"
              >
                <ComposedChart data={data.dailyActivity}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis
                    dataKey="date"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={formatDayTick}
                  />
                  <YAxis yAxisId="left" tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                  <YAxis
                    yAxisId="right"
                    orientation="right"
                    tick={{ fontSize: 11 }}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    content={
                      <ChartTooltipContent
                        labelFormatter={(value) => formatDate(parseDay(String(value)), locale)}
                      />
                    }
                  />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Bar
                    yAxisId="left"
                    dataKey="reviews"
                    fill="var(--color-reviews)"
                    radius={[4, 4, 0, 0]}
                  />
                  <Line
                    yAxisId="right"
                    dataKey="activeStudents"
                    stroke="var(--color-activeStudents)"
                    strokeWidth={2}
                    dot={{ r: 3, fill: 'var(--color-activeStudents)' }}
                  />
                </ComposedChart>
              </ChartContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('student_table')}</CardTitle>
              <CardDescription>{t(`range_${range}`)}</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('student')}</TableHead>
                    <TableHead>{t('last_active')}</TableHead>
                    <TableHead className="text-right">{t('practices')}</TableHead>
                    <TableHead className="text-right">{t('accuracy')}</TableHead>
                    <TableHead className="text-right">{t('quizzes')}</TableHead>
                    <TableHead>{t('status')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.students.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                        {t('no_data')}
                      </TableCell>
                    </TableRow>
                  ) : (
                    data.students.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="font-medium">{s.name}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatLastActive(s.lastActive)}
                        </TableCell>
                        <TableCell className="text-right">{s.practices7d}</TableCell>
                        <TableCell className="text-right">
                          {s.accuracy7d !== null ? `${s.accuracy7d}%` : '—'}
                        </TableCell>
                        <TableCell className="text-right">{s.quizzes7d}</TableCell>
                        <TableCell>
                          <Badge
                            variant={
                              s.status === 'active'
                                ? 'default'
                                : s.status === 'recent'
                                  ? 'secondary'
                                  : 'outline'
                            }
                          >
                            {s.status === 'active' ? '🟢 ' : s.status === 'recent' ? '🟡 ' : '🔴 '}
                            {t(`status_${s.status}`)}
                          </Badge>
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
