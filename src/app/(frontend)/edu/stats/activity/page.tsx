'use client';

import { useEffect, useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Line, ComposedChart, Legend } from 'recharts';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendingUp, TrendingDown, Users, BookOpen, Target, ClipboardList } from 'lucide-react';

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

type QuizItem = {
  difficulty: string;
  attempts: number;
  avgScore: number;
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
  quizzes: QuizItem[];
};

function TrendIndicator({ current, previous }: MetricComp) {
  if (previous === 0) return null;
  const diff = current - previous;
  const pct = Math.round((diff / previous) * 100);
  if (pct === 0) return <span className="text-xs text-muted-foreground ml-1">→ 0%</span>;
  return (
    <span className={`text-xs ml-1 flex items-center gap-0.5 ${pct > 0 ? 'text-green-600' : 'text-red-500'}`}>
      {pct > 0 ? <TrendingUp className="size-3" /> : <TrendingDown className="size-3" />}
      {Math.abs(pct)}%
    </span>
  );
}

function formatLastActive(dateStr: string | null): string {
  if (!dateStr) return '—';
  const diff = Date.now() - new Date(dateStr).getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  if (hours < 1) return 'Today';
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

const RANGES = ['7d', '30d', '90d'] as const;

export default function TeacherActivityPage() {
  const t = useTranslations('TeacherActivityPage');
  const [range, setRange] = useState<'7d' | '30d' | '90d'>('7d');
  const [data, setData] = useState<ActivityData | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/stats/teacher/activity?range=${range}`);
      const json = await res.json();
      setData(json.data || json);
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [range]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const summaryCards = data ? [
    { title: t('active_students'), value: `${data.summary.activeStudents.current}`, icon: Users, metric: data.summary.activeStudents },
    { title: t('total_practices'), value: data.summary.totalPractices.current.toLocaleString(), icon: BookOpen, metric: data.summary.totalPractices },
    { title: t('avg_accuracy'), value: `${data.summary.avgAccuracy.current}%`, icon: Target, metric: data.summary.avgAccuracy },
    { title: t('quizzes_taken'), value: data.summary.totalQuizzes.current.toString(), icon: ClipboardList, metric: data.summary.totalQuizzes },
  ] : [];

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
            {[1, 2, 3, 4].map((i) => <Skeleton key={i} className="h-28 rounded-xl" />)}
          </div>
          <Skeleton className="h-72 rounded-xl" />
          <Skeleton className="h-64 rounded-xl" />
        </div>
      ) : !data ? (
        <Card><CardContent className="py-12 text-center text-muted-foreground">{t('no_data')}</CardContent></Card>
      ) : (
        <>
          <div className="grid gap-4 md:grid-cols-4">
            {summaryCards.map((card) => (
              <Card key={card.title}>
                <CardHeader className="pb-2 flex flex-row items-center justify-between">
                  <CardTitle className="text-sm text-muted-foreground font-medium">{card.title}</CardTitle>
                  <card.icon className="size-4 text-muted-foreground" />
                </CardHeader>
                <CardContent>
                  <div className="flex items-baseline gap-2">
                    <p className="text-3xl font-bold">{card.value}</p>
                    <TrendIndicator current={card.metric.current} previous={card.metric.previous} />
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">{t('vs_previous')}</p>
                </CardContent>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t('daily_activity')}</CardTitle>
              <CardDescription>{t('range_' + range)}</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={data.dailyActivity}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis
                      dataKey="date"
                      tick={{ fontSize: 11 }}
                      tickFormatter={(d: string) => {
                        const date = new Date(d);
                        return `${date.getMonth() + 1}/${date.getDate()}`;
                      }}
                    />
                    <YAxis yAxisId="left" tick={{ fontSize: 11 }} />
                    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 11 }} />
                    <Tooltip
                      contentStyle={{ borderRadius: '8px', border: '1px solid hsl(var(--border))' }}
                      labelFormatter={(d: string) => new Date(d).toLocaleDateString()}
                    />
                    <Legend />
                    <Bar yAxisId="left" dataKey="reviews" name={t('reviews')} fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                    <Line yAxisId="right" dataKey="activeStudents" name={t('active_students_chart')} stroke="hsl(var(--destructive))" strokeWidth={2} dot={{ r: 3 }} />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('student_table')}</CardTitle>
              <CardDescription>{t('range_' + range)}</CardDescription>
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
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-8">{t('no_data')}</TableCell></TableRow>
                  ) : (
                    data.students.map((s) => (
                      <TableRow key={s.id}>
                        <TableCell className="font-medium">{s.name}</TableCell>
                        <TableCell className="text-muted-foreground">{formatLastActive(s.lastActive)}</TableCell>
                        <TableCell className="text-right">{s.practices7d}</TableCell>
                        <TableCell className="text-right">{s.accuracy7d !== null ? `${s.accuracy7d}%` : '—'}</TableCell>
                        <TableCell className="text-right">{s.quizzes7d}</TableCell>
                        <TableCell>
                          <Badge variant={s.status === 'active' ? 'default' : s.status === 'recent' ? 'secondary' : 'outline'}>
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

          <Card>
            <CardHeader>
              <CardTitle>{t('quiz_activity')}</CardTitle>
              <CardDescription>{t('range_' + range)}</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('quiz_difficulty')}</TableHead>
                    <TableHead className="text-right">{t('quiz_attempts')}</TableHead>
                    <TableHead className="text-right">{t('quiz_avg_score')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.quizzes.length === 0 ? (
                    <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-8">{t('no_data')}</TableCell></TableRow>
                  ) : (
                    data.quizzes.map((q) => (
                      <TableRow key={q.difficulty}>
                        <TableCell className="capitalize">{q.difficulty}</TableCell>
                        <TableCell className="text-right">{q.attempts}</TableCell>
                        <TableCell className="text-right">
                          <Badge variant={q.avgScore >= 70 ? 'default' : q.avgScore >= 40 ? 'secondary' : 'destructive'}>
                            {q.avgScore}%
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
