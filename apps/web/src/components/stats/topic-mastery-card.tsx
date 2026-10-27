'use client';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Progress,
  Skeleton,
} from '@studiq/ui';
import { useTranslations } from 'next-intl';
import { useStudentInsights } from '@/hooks/use-student-insights';
import { masteryLevel, visibleMastery } from '@/lib/study-insights';

const DAYS = 30;

const LEVEL_CLASS = {
  low: '[&>div]:bg-rose-500',
  medium: '[&>div]:bg-amber-500',
  high: '[&>div]:bg-emerald-500',
} as const;

/** Mastery per topic: quiz answers and flashcard reviews together, with the split shown. */
export function TopicMasteryCard() {
  const t = useTranslations('StudentInsights');
  const { data, isLoading } = useStudentInsights(DAYS);
  const topics = visibleMastery(data?.mastery ?? []);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('mastery_title')}</CardTitle>
        <CardDescription>{t('mastery_desc', { days: DAYS })}</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <Skeleton className="h-40 w-full" />
        ) : topics.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">{t('mastery_empty')}</p>
        ) : (
          <ul className="space-y-4">
            {topics.map((topic) => (
              <li key={topic.topicId} className="space-y-1.5">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="truncate text-sm font-medium">{topic.name}</span>
                  <span className="shrink-0 text-sm font-semibold tabular-nums">
                    {topic.accuracy}%
                  </span>
                </div>
                <Progress
                  value={topic.accuracy}
                  className={LEVEL_CLASS[masteryLevel(topic.accuracy)]}
                  aria-label={`${topic.name}: ${topic.accuracy}%`}
                />
                <p className="text-xs text-muted-foreground">
                  {t('mastery_split', {
                    quiz: topic.quizAccuracy === null ? '—' : `${topic.quizAccuracy}%`,
                    quizCount: topic.quizAnswers,
                    cards: topic.flashcardAccuracy === null ? '—' : `${topic.flashcardAccuracy}%`,
                    cardCount: topic.flashcardReviews,
                  })}
                </p>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
