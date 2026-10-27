'use client';

import type { ResumeDeck, ResumeQuiz } from '@studiq/server/models/student-overview.model';
import { Card, CardContent, CardDescription, CardHeader, CardTitle, Progress } from '@studiq/ui';
import { ArrowRight, BookOpen, Layers, PlayCircle } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { formatRelativeTime } from '@/lib/relative-time';

interface ContinueCardProps {
  quiz: ResumeQuiz | null | undefined;
  deck: ResumeDeck | null | undefined;
  isLoading: boolean;
}

/** "Continue where you left off": the unfinished practice quiz and the last studied deck. */
export function ContinueCard({ quiz, deck, isLoading }: ContinueCardProps) {
  const t = useTranslations('AppDashboard');
  const locale = useLocale();

  return (
    <Card className="overflow-hidden">
      <CardHeader className="pb-4">
        <CardTitle className="flex items-center gap-2 text-base">
          <div className="rounded-lg bg-primary/10 p-1.5">
            <PlayCircle className="h-4 w-4 text-primary" aria-hidden="true" />
          </div>
          {t('continue_title')}
        </CardTitle>
        <CardDescription>{t('continue_desc')}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-2 pb-6">
        {isLoading ? (
          <div className="h-20 animate-pulse rounded-xl bg-muted" />
        ) : !quiz && !deck ? (
          <p className="py-4 text-center text-sm text-muted-foreground">{t('continue_empty')}</p>
        ) : (
          <>
            {quiz && (
              <Link href={`/app/study/session/quiz/${quiz.attemptId}`} className="group block">
                <div className="space-y-2 rounded-xl border border-blue-500/10 bg-blue-500/5 p-4 transition-colors hover:border-blue-500/25 hover:bg-blue-500/10">
                  <div className="flex items-center gap-3">
                    <BookOpen
                      className="h-4 w-4 shrink-0 text-blue-600 dark:text-blue-400"
                      aria-hidden="true"
                    />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-semibold">
                        {quiz.title ?? t('untitled_quiz')}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {t('quiz_progress', { answered: quiz.answered, total: quiz.total })}
                      </p>
                    </div>
                    <ArrowRight
                      className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1"
                      aria-hidden="true"
                    />
                  </div>
                  <Progress
                    value={quiz.total > 0 ? Math.min(100, (quiz.answered / quiz.total) * 100) : 0}
                    aria-label={t('quiz_progress', { answered: quiz.answered, total: quiz.total })}
                  />
                </div>
              </Link>
            )}
            {deck && (
              <Link href={`/app/flashcards/${deck.deckId}`} className="group block">
                <div className="flex items-center gap-3 rounded-xl border border-violet-500/10 bg-violet-500/5 p-4 transition-colors hover:border-violet-500/25 hover:bg-violet-500/10">
                  <Layers
                    className="h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400"
                    aria-hidden="true"
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">{deck.name}</p>
                    <p className="text-xs text-muted-foreground">
                      {t('deck_last_studied', {
                        when: formatRelativeTime(deck.lastStudiedAt, locale),
                      })}
                    </p>
                  </div>
                  <ArrowRight
                    className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1"
                    aria-hidden="true"
                  />
                </div>
              </Link>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
