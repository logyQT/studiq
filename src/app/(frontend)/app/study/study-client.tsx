'use client';

import {
  Brain,
  ClipboardList,
  Dumbbell,
  FolderOpen,
  History,
  ListChecks,
  Lock,
  Play,
  Plus,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { CramDeckCard } from '@/components/flashcards/cards/cram-deck-card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import { Field, FieldContent, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { useApiQuery } from '@/hooks/use-api';
import { useFeature } from '@/hooks/use-feature';
import { apiPost } from '@/lib/api';
import { flashcardKeys } from '@/lib/query-keys';
import type { Deck } from '@/types/flashcards';

interface StudySettings {
  remainingNewCards: number;
  newCardsPerDay: number;
  newCardsIntroduced: number;
  totalNewCards: number;
}

interface QuizAttempt {
  id: string;
  score: number;
  total_questions: number;
  config: {
    subjectId?: string;
    questionTypes?: string[];
    questionCount?: number;
  } | null;
  started_at: string;
  completed_at: string | null;
}

interface Subject {
  id: string;
  name: string;
}

const QUESTION_TYPE_OPTIONS = [
  { value: 'mcq', label: 'MCQ' },
  { value: 'true_false', label: 'True/False' },
  { value: 'open', label: 'Open' },
] as const;

export default function StudyClient() {
  const t = useTranslations('AppFlashcardStudyPage');
  const router = useRouter();
  const { hasAccess } = useFeature('test.create');

  const { data: dueCount, isLoading: countLoading } = useApiQuery<{ count: number }>({
    queryKey: [...flashcardKeys.practice.dueBreakdown, 'count'],
    url: '/api/v1/flashcards/practice/due/count',
  });
  const { data: settings, isLoading: settingsLoading } = useApiQuery<StudySettings>({
    queryKey: [...flashcardKeys.all, 'practice', 'settings'],
    url: '/api/v1/flashcards/practice/settings',
  });
  const { data: decksData, isLoading: decksLoading } = useApiQuery<{
    items: Deck[];
    nextCursor: string | null;
    hasMore: boolean;
  }>({
    queryKey: flashcardKeys.decks.all,
    url: '/api/v1/flashcards/decks?limit=200',
  });
  const decks = decksData?.items;

  const { data: subjectsData } = useApiQuery<{ items: Subject[] }>({
    queryKey: ['subjects'],
    url: '/api/v1/subjects',
  });
  const subjects = subjectsData?.items;

  const { data: attemptsData } = useApiQuery<QuizAttempt[]>({
    queryKey: ['quiz', 'attempts'],
    url: '/api/v1/quiz/attempts',
  });
  const attempts = attemptsData;

  const isLoading = countLoading || settingsLoading || decksLoading;

  // Study tab state
  const [studyMode, setStudyMode] = useState<'endless' | 'limited'>('endless');
  const [targetCount, setTargetCount] = useState(10);

  // Quiz form state
  const [quizSubjectId, setQuizSubjectId] = useState<string>('');
  const [quizTypes, setQuizTypes] = useState<string[]>([]);
  const [quizCount, setQuizCount] = useState(10);
  const [quizSubmitting, setQuizSubmitting] = useState(false);

  function toggleQuizType(type: string) {
    setQuizTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );
  }

  function startReview() {
    const params = new URLSearchParams();
    params.set('studyMode', studyMode);
    if (studyMode === 'limited') params.set('target', String(targetCount));
    router.push(`/app/study/session/review?${params.toString()}`);
  }

  function startLearning() {
    router.push('/app/study/session/new?studyMode=endless');
  }

  function startCram(deckId: string) {
    router.push(`/app/study/session/cram?deckId=${deckId}`);
  }

  async function handleGenerateQuiz() {
    setQuizSubmitting(true);
    try {
      const data = await apiPost<{ id: string }>('/api/v1/quiz/new', {
        ...(quizSubjectId ? { subjectId: quizSubjectId } : {}),
        ...(quizTypes.length > 0 ? { questionTypes: quizTypes } : {}),
        questionCount: quizCount,
      });
      router.push(`/app/study/session/quiz/${data.id}`);
    } catch {
      toast.error('Failed to generate quiz');
    } finally {
      setQuizSubmitting(false);
    }
  }

  const totalDue = dueCount?.count ?? 0;
  const remainingNew = settings?.remainingNewCards ?? 0;
  const newCardsPerDay = settings?.newCardsPerDay ?? 20;
  const newProgress =
    newCardsPerDay > 0 ? ((newCardsPerDay - remainingNew) / newCardsPerDay) * 100 : 100;

  const showDue = totalDue > 0;
  const showNew = !showDue && remainingNew > 0;
  const _showAllCaughtUp = !showDue && !showNew;
  const hasAnyCards = showDue || showNew;

  return (
    <Tabs defaultValue="study" className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <TabsList>
          <TabsTrigger value="study" className="gap-2">
            <Play className="size-4" /> {t('tab_study')}
          </TabsTrigger>
          <TabsTrigger value="cram" className="gap-2">
            <Dumbbell className="size-4" /> {t('tab_cram_deck')}
          </TabsTrigger>
          <TabsTrigger value="quiz" className="gap-2">
            <ClipboardList className="size-4" /> {t('tab_quiz')}
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-2">
            <History className="size-4" /> {t('tab_history')}
          </TabsTrigger>
        </TabsList>
        <Button variant="outline" size="sm" onClick={() => router.push('/app/statistics')}>
          <TrendingUp data-icon="inline-start" /> {t('statistics')}
        </Button>
      </div>

      <TabsContent value="study" className="flex flex-col gap-6 mt-0">
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
      </TabsContent>

      <TabsContent value="cram" className="flex flex-col gap-6 mt-0">
        <p className="text-muted-foreground">{t('deck_picker_desc')}</p>

        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="flex min-w-0 flex-col max-sm:py-0">
                <div className="flex items-center gap-3 p-4 sm:hidden">
                  <Skeleton className="size-10 shrink-0 rounded-xl" />
                  <div className="flex flex-1 flex-col gap-2">
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-3 w-1/4" />
                  </div>
                  <Skeleton className="size-7 shrink-0 rounded-md" />
                </div>
                <div className="hidden h-full flex-col gap-4 p-5 sm:flex">
                  <div className="flex items-center gap-3">
                    <Skeleton className="size-10 rounded-xl" />
                    <Skeleton className="h-6 w-3/4" />
                  </div>
                  <div className="flex flex-1 flex-col gap-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-4/5" />
                  </div>
                  <div className="flex items-center justify-between pt-4">
                    <Skeleton className="h-6 w-16 rounded-full" />
                    <Skeleton className="h-8 w-24 rounded-md" />
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : decks && decks.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {decks.map((deck) => (
              <CramDeckCard key={deck.id} deck={deck} onStart={() => startCram(deck.id)} t={t} />
            ))}
          </div>
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <FolderOpen className="size-6" />
              </EmptyMedia>
              <EmptyTitle>{t('no_decks_picker')}</EmptyTitle>
            </EmptyHeader>
          </Empty>
        )}
      </TabsContent>

      <TabsContent value="quiz" className="flex flex-col gap-6 mt-0">
        <p className="text-muted-foreground">{t('quiz_desc')}</p>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus className="size-5" /> {t('new_quiz')}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <FieldGroup>
              <Field orientation="vertical">
                <FieldLabel>{t('quiz_subject')}</FieldLabel>
                <FieldContent>
                  <Select value={quizSubjectId} onValueChange={setQuizSubjectId}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder={t('quiz_subject_placeholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {subjects?.map((s) => (
                        <SelectItem key={s.id} value={s.id}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </FieldContent>
              </Field>

              <Field orientation="vertical">
                <FieldLabel>{t('quiz_types')}</FieldLabel>
                <FieldContent>
                  <div className="flex flex-wrap gap-3">
                    {QUESTION_TYPE_OPTIONS.map((opt) => (
                      <div key={opt.value} className="flex items-center gap-2">
                        <Checkbox
                          checked={quizTypes.includes(opt.value)}
                          onCheckedChange={() => toggleQuizType(opt.value)}
                          id={`quiz-type-${opt.value}`}
                        />
                        <Label htmlFor={`quiz-type-${opt.value}`}>{opt.label}</Label>
                      </div>
                    ))}
                  </div>
                </FieldContent>
              </Field>

              <Field orientation="vertical">
                <FieldLabel>{t('quiz_count')}</FieldLabel>
                <FieldContent>
                  <Input
                    type="number"
                    min={1}
                    max={50}
                    value={quizCount}
                    onChange={(e) =>
                      setQuizCount(Math.max(1, Math.min(50, parseInt(e.target.value, 10) || 1)))
                    }
                  />
                </FieldContent>
              </Field>
            </FieldGroup>

            <Button
              className="mt-6 w-full"
              disabled={!hasAccess || quizSubmitting}
              onClick={
                hasAccess
                  ? handleGenerateQuiz
                  : () => router.push('/checkout?plan_id=student_premium')
              }
            >
              {hasAccess ? (
                <>
                  <ListChecks data-icon="inline-start" /> {t('generate_quiz')}
                </>
              ) : (
                <>
                  <Lock className="size-3" /> Upgrade
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="history" className="flex flex-col gap-6 mt-0">
        {attempts && attempts.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {attempts.map((attempt) => {
              const percentage = Math.round((attempt.score / attempt.total_questions) * 100);
              return (
                <Card key={attempt.id}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <Badge variant={attempt.completed_at ? 'default' : 'secondary'}>
                        {attempt.completed_at ? 'Completed' : 'In Progress'}
                      </Badge>
                      <span className="text-2xl font-bold">{percentage}%</span>
                    </div>
                    <CardTitle className="text-base mt-2">
                      {`${attempt.score}/${attempt.total_questions} correct`}
                    </CardTitle>
                    <CardDescription>
                      {new Date(attempt.started_at).toLocaleDateString()}
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full"
                      onClick={() =>
                        router.push(
                          attempt.completed_at
                            ? `/app/study/session/quiz/${attempt.id}/review`
                            : `/app/study/session/quiz/${attempt.id}`,
                        )
                      }
                    >
                      {attempt.completed_at ? (
                        <>
                          <Brain data-icon="inline-start" /> Review
                        </>
                      ) : (
                        <>
                          <Play data-icon="inline-start" /> Resume
                        </>
                      )}
                    </Button>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <History className="size-6" />
              </EmptyMedia>
              <EmptyTitle>{t('no_history')}</EmptyTitle>
              <EmptyDescription>{t('no_history_desc')}</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </TabsContent>
    </Tabs>
  );
}
