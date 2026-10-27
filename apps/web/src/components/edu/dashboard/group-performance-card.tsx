'use client';

import type { TeacherGroupPerformance } from '@studiq/server/models/stats.model';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ChartContainer,
  ChartTooltipContent,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@studiq/ui';
import { Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Bar, BarChart, CartesianGrid, Tooltip, XAxis, YAxis } from 'recharts';
import { CardError } from '@/components/edu/dashboard/card-error';

interface GroupPerformanceCardProps {
  data: TeacherGroupPerformance | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  days: number;
}

export function GroupPerformanceCard({
  data,
  isLoading,
  isError,
  onRetry,
  days,
}: GroupPerformanceCardProps) {
  const t = useTranslations('EduOverviewPage');
  const groups = data?.groups;

  /** "No data" in words: a group without graded attempts is not at 0 %. */
  const percent = (value: number | null) => (value === null ? t('no_data') : `${value}%`);

  const withScores = (groups ?? []).filter((g) => g.avgScore !== null);

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-4">
        <CardTitle role="heading" aria-level={2} className="flex items-center gap-2 text-base">
          <div className="rounded-lg bg-primary/10 p-1.5">
            <Users className="h-4 w-4 text-primary" aria-hidden="true" />
          </div>
          {t('group_performance_title')}
        </CardTitle>
        <CardDescription>{t('group_performance_desc', { days })}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6 pb-6">
        {isLoading ? (
          <div className="h-[220px] animate-pulse rounded-xl bg-muted" />
        ) : isError ? (
          <CardError onRetry={onRetry} />
        ) : !groups || groups.length === 0 ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{t('no_groups')}</p>
        ) : (
          <>
            {withScores.length > 0 ? (
              <ChartContainer
                // The theme defines no `--chart-N` tokens; the other charts use literal colours too.
                config={{ avgScore: { label: t('col_avg'), color: 'oklch(0.546 0.245 265)' } }}
                className="aspect-auto h-[220px] w-full"
              >
                <BarChart data={withScores} margin={{ left: 0, right: 8, top: 8 }}>
                  <CartesianGrid vertical={false} />
                  <XAxis dataKey="groupName" tickLine={false} axisLine={false} tickMargin={8} />
                  <YAxis domain={[0, 100]} tickLine={false} axisLine={false} width={36} unit="%" />
                  <Tooltip content={<ChartTooltipContent />} />
                  <Bar dataKey="avgScore" fill="var(--color-avgScore)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ChartContainer>
            ) : (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {t('no_group_data', { days })}
              </p>
            )}

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('col_group')}</TableHead>
                  <TableHead className="text-right">{t('col_students')}</TableHead>
                  <TableHead className="text-right">{t('col_attempts')}</TableHead>
                  <TableHead className="text-right">{t('col_avg')}</TableHead>
                  <TableHead className="text-right">{t('col_flashcard_accuracy')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {groups.map((group) => (
                  <TableRow key={group.groupId}>
                    <TableCell className="font-medium">{group.groupName}</TableCell>
                    <TableCell className="text-right tabular-nums">{group.students}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      {group.completedAttempts}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {percent(group.avgScore)}
                      {group.awaitingGrade > 0 && (
                        <span className="block text-xs text-muted-foreground">
                          {t('awaiting_grade', { count: group.awaitingGrade })}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {percent(group.flashcardAccuracy)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </>
        )}
      </CardContent>
    </Card>
  );
}
