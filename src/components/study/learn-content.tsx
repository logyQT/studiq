'use client';

import { Brain, Play, Sparkles } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useApiQuery } from '@/hooks/use-api';
import { flashcardKeys } from '@/lib/query-keys';

interface StudySettings {
  remainingNewCards: number;
  newCardsPerDay: number;
  newCardsIntroduced: number;
  totalNewCards: number;
}

export function LearnContent() {
  const t = useTranslations('AppFlashcardStudyPage');
  const router = useRouter();

  const { data: dueCount, isLoading: countLoading } = useApiQuery<{ count: number }>({
    queryKey: [...flashcardKeys.practice.dueBreakdown, 'count'],
    url: '/api/v1/flashcards/practice/due/count',
  });
  const { data: settings, isLoading: settingsLoading } = useApiQuery<StudySettings>({
    queryKey: [...flashcardKeys.all, 'practice', 'settings'],
    url: '/api/v1/flashcards/practice/settings',
  });

  const [studyMode, setStudyMode] = useState<'endless' | 'limited'>('endless');
  const [targetCount, setTargetCount] = useState(10);

  const isLoading = countLoading || settingsLoading;

  const totalDue = dueCount?.count ?? 0;
  const remainingNew = settings?.remainingNewCards ?? 0;
  const newCardsPerDay = settings?.newCardsPerDay ?? 20;
  const newProgress =
    newCardsPerDay > 0 ? ((newCardsPerDay - remainingNew) / newCardsPerDay) * 100 : 100;

  const showDue = totalDue > 0;
  const showNew = !showDue && remainingNew > 0;
  const _showAllCaughtUp = !showDue && !showNew;
  const hasAnyCards = showDue || showNew;

  function startReview() {
    const params = new URLSearchParams();
    params.set('studyMode', studyMode);
    if (studyMode === 'limited') params.set('target', String(targetCount));
    router.push(`/app/study/session/review?${params.toString()}`);
  }

  function startLearning() {
    router.push('/app/study/session/new?studyMode=endless');
  }

  return (
    <div className="flex flex-col gap-6">
      {isLoading ? (
        <Card>
          <CardHeader>
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-64" />
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <div className="flex gap-4">
              <Skeleton className="h-20 flex-1 rounded-lg" />
              <Skeleton className="h-20 flex-1 rounded-lg" />
            </div>
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-10 w-28" />
            </div>
          </CardContent>
        </Card>
      ) : hasAnyCards ? (
        <Card>
          <CardHeader>
            <CardTitle>{showDue ? t('review_title') : t('learn_title')}</CardTitle>
            <CardDescription>{showDue ? t('review_desc') : t('learn_desc')}</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            {showDue && (
              <div className="flex items-center gap-3 rounded-lg border bg-primary/5 p-4">
                <Brain className="size-8 text-primary" />
                <div>
                  <p className="text-2xl font-bold">{totalDue}</p>
                  <p className="text-sm text-muted-foreground">{t('cards_due')}</p>
                </div>
              </div>
            )}

            {showNew && (
              <div className="flex flex-col gap-3">
                <div className="flex items-center gap-3 rounded-lg border bg-emerald-500/5 p-4">
                  <Sparkles className="size-8 text-emerald-500" />
                  <div>
                    <p className="text-2xl font-bold">{remainingNew}</p>
                    <p className="text-sm text-muted-foreground">{t('new_cards_available')}</p>
                  </div>
                </div>
                <div className="flex flex-col gap-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">
                      {t('daily_progress', { remaining: remainingNew, total: newCardsPerDay })}
                    </span>
                    <span className="font-medium">{Math.round(newProgress)}%</span>
                  </div>
                  <Progress value={newProgress} />
                </div>
                {settings && settings.totalNewCards < settings.newCardsPerDay && (
                  <p className="text-xs text-muted-foreground">
                    {t('new_cards_hint', { count: settings.totalNewCards })}
                  </p>
                )}
              </div>
            )}

            {showDue && (
              <div className="flex flex-col gap-2">
                <Label>{t('mode')}</Label>
                <ToggleGroup
                  type="single"
                  value={studyMode}
                  onValueChange={(v) => v && setStudyMode(v as 'endless' | 'limited')}
                >
                  <ToggleGroupItem value="endless" className="flex-1">
                    {t('mode_endless')}
                  </ToggleGroupItem>
                  <ToggleGroupItem value="limited" className="flex-1">
                    {t('mode_limited')}
                  </ToggleGroupItem>
                </ToggleGroup>
                <p className="text-sm text-muted-foreground">
                  {studyMode === 'endless' ? t('mode_endless_desc') : t('mode_limited_desc')}
                </p>
              </div>
            )}

            {studyMode === 'limited' && showDue && (
              <div className="flex flex-col gap-2">
                <Label>{t('target_count_label', { count: targetCount })}</Label>
                <Input
                  type="number"
                  min={1}
                  max={100}
                  value={targetCount}
                  onChange={(e) =>
                    setTargetCount(Math.max(1, Math.min(100, parseInt(e.target.value, 10) || 1)))
                  }
                  className="max-w-32"
                />
              </div>
            )}

            <div className="flex justify-end">
              <Button onClick={showDue ? startReview : startLearning} size="lg">
                <Play data-icon="inline-start" />
                {showDue ? t('start_review') : t('start_learning')}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="flex flex-col items-center gap-4 py-12">
            <div className="rounded-full bg-primary/10 p-4">
              <Sparkles className="size-8 text-primary" />
            </div>
            <h3 className="text-lg font-semibold">{t('all_caught_up')}</h3>
            <p className="text-sm text-muted-foreground text-center max-w-sm">
              {t('all_caught_up_desc')}
            </p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
