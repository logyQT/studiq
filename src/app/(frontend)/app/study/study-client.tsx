'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Play,
  FolderOpen,
  Tags,
  Dumbbell,
  Sparkles,
  Moon,
  Brain,
  ClipboardList,
  History,
  Plus,
  ListChecks,
  TrendingUp,
} from 'lucide-react';
import { useApiQuery } from '@/hooks/use-api';
import { flashcardKeys } from '@/lib/query-keys';
import { Progress } from '@/components/ui/progress';
import { CramDeckCard } from '@/components/flashcards/cards/cram-deck-card';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import {
  Empty,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
  EmptyDescription,
} from '@/components/ui/empty';
import { FieldGroup, Field, FieldContent, FieldLabel } from '@/components/ui/field';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { apiPost } from '@/lib/api';
import { toast } from 'sonner';
import type { Topic, Deck } from '@/types/flashcards';

interface DueBreakdown {
  total: number;
  nextReviewAt: string | null;
  byTopic: Record<string, number>;
  byDeck: Record<string, number>;
}

interface StudySettings {
  remainingNewCards: number;
  newCardsPerDay: number;
  newCardsIntroduced: number;
}

interface QuizAttempt {
  id: string;
  score: number;
  total_questions: number;
  config: {
    subjectId?: string;
    questionTypes?: string[];
    difficulty?: string;
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

const DIFFICULTY_OPTIONS = [
  { value: 'easy', label: 'Easy' },
  { value: 'medium', label: 'Medium' },
  { value: 'hard', label: 'Hard' },
  { value: 'mixed', label: 'Mixed' },
] as const;

export default function StudyClient() {
  const t = useTranslations('AppFlashcardStudyPage');
  const router = useRouter();

  const { data: topicsData, isLoading: topicsLoading } = useApiQuery<{
    items: Topic[];
    nextCursor: string | null;
    hasMore: boolean;
  }>({
    queryKey: flashcardKeys.topics.all,
    url: '/api/v1/flashcards/topics?limit=200',
  });
  const { data: decksData, isLoading: decksLoading } = useApiQuery<{
    items: Deck[];
    nextCursor: string | null;
    hasMore: boolean;
  }>({
    queryKey: flashcardKeys.decks.all,
    url: '/api/v1/flashcards/decks?limit=200',
  });
  const topics = topicsData?.items;
  const decks = decksData?.items;
  const { data: dueBreakdown, isLoading: breakdownLoading } = useApiQuery<DueBreakdown>({
    queryKey: flashcardKeys.practice.dueBreakdown,
    url: '/api/v1/flashcards/practice/due/breakdown',
  });
  const { data: settings, isLoading: settingsLoading } = useApiQuery<StudySettings>({
    queryKey: [...flashcardKeys.all, 'practice', 'settings'],
    url: '/api/v1/flashcards/practice/settings',
  });

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

  const isLoading =
    topicsLoading || decksLoading || breakdownLoading || settingsLoading;

  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [selectedDecks, setSelectedDecks] = useState<string[]>([]);
  const [studyMode, setStudyMode] = useState<'endless' | 'limited'>('endless');
  const [targetCount, setTargetCount] = useState(10);

  const isFiltered = selectedTopics.length > 0 || selectedDecks.length > 0;

  const displayedCount = isFiltered
    ? selectedTopics.reduce((sum, id) => sum + (dueBreakdown?.byTopic[id] ?? 0), 0) +
      selectedDecks.reduce((sum, id) => sum + (dueBreakdown?.byDeck[id] ?? 0), 0)
    : (dueBreakdown?.total ?? 0);

  // Quiz form state
  const [quizSubjectId, setQuizSubjectId] = useState<string>('');
  const [quizTypes, setQuizTypes] = useState<string[]>([]);
  const [quizDifficulty, setQuizDifficulty] = useState<string>('mixed');
  const [quizCount, setQuizCount] = useState(10);
  const [quizSubmitting, setQuizSubmitting] = useState(false);

  function toggleTopic(id: string) {
    setSelectedTopics((prev) =>
      prev.includes(id) ? prev.filter((tid) => tid !== id) : [...prev, id],
    );
  }

  function toggleDeck(id: string) {
    setSelectedDecks((prev) =>
      prev.includes(id) ? prev.filter((did) => did !== id) : [...prev, id],
    );
  }

  function toggleQuizType(type: string) {
    setQuizTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );
  }

  function startReview() {
    const params = new URLSearchParams();
    if (selectedTopics.length > 0) params.set('topics', selectedTopics.join(','));
    if (selectedDecks.length > 0) params.set('decks', selectedDecks.join(','));
    params.set('studyMode', studyMode);
    if (studyMode === 'limited') params.set('target', String(targetCount));
    router.push(`/app/study/session/review?${params.toString()}`);
  }

  function startLearning() {
    const params = new URLSearchParams();
    params.set('newOnly', 'true');
    params.set('studyMode', 'endless');
    router.push(`/app/study/session/learn?${params.toString()}`);
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
        ...(quizDifficulty !== 'mixed' ? { difficulty: quizDifficulty } : {}),
        questionCount: quizCount,
      });
      router.push(`/app/study/session/quiz/${data.id}`);
    } catch {
      toast.error('Failed to generate quiz');
    } finally {
      setQuizSubmitting(false);
    }
  }

  const remainingNew = settings?.remainingNewCards ?? 0;
  const newCardsPerDay = settings?.newCardsPerDay ?? 20;
  const newProgress =
    newCardsPerDay > 0 ? ((newCardsPerDay - remainingNew) / newCardsPerDay) * 100 : 100;

  return (
    <Tabs defaultValue="review" className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <TabsList>
          <TabsTrigger value="review" className="gap-2">
            <Play className="size-4" /> {t('tab_review_due')}
          </TabsTrigger>
          <TabsTrigger value="learn" className="gap-2">
            <Sparkles className="size-4" /> {t('tab_learn_new')}
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
        <Button
          variant="outline"
          size="sm"
          onClick={() => router.push('/app/statistics')}
        >
          <TrendingUp data-icon="inline-start" /> {t('statistics')}
        </Button>
      </div>

      <TabsContent value="review" className="flex flex-col gap-6 mt-0">
        {isLoading ? (
          <>
            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <Skeleton className="h-6 w-32" />
                  <Skeleton className="h-4 w-48" />
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full rounded-lg" />
                  ))}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <Skeleton className="h-6 w-32" />
                  <Skeleton className="h-4 w-48" />
                </CardHeader>
                <CardContent className="flex flex-col gap-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full rounded-lg" />
                  ))}
                </CardContent>
              </Card>
            </div>
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
          </>
        ) : (
          <>
            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Tags className="size-5" /> {t('topics_title')}
                  </CardTitle>
                  <CardDescription>{t('topics_desc')}</CardDescription>
                </CardHeader>
                <CardContent>
                  {topics && topics.length > 0 ? (
                    <div className="flex max-h-64 flex-col gap-2 overflow-y-auto">
                      {topics.map((topic) => (
                        <div
                          key={topic.id}
                          className="flex items-center gap-3 rounded-lg border p-3"
                        >
                          <Checkbox
                            checked={selectedTopics.includes(topic.id)}
                            onCheckedChange={() => toggleTopic(topic.id)}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium">{topic.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {t('cards_count', { count: topic.flashcard_count })}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="py-4 text-center text-sm text-muted-foreground">
                      {t('no_topics')}
                    </p>
                  )}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FolderOpen className="size-5" /> {t('decks_title')}
                  </CardTitle>
                  <CardDescription>{t('decks_desc')}</CardDescription>
                </CardHeader>
                <CardContent>
                  {decks && decks.length > 0 ? (
                    <div className="flex max-h-64 flex-col gap-2 overflow-y-auto">
                      {decks.map((deck) => (
                        <div
                          key={deck.id}
                          className="flex items-center gap-3 rounded-lg border p-3"
                        >
                          <Checkbox
                            checked={selectedDecks.includes(deck.id)}
                            onCheckedChange={() => toggleDeck(deck.id)}
                          />
                          <div className="min-w-0 flex-1">
                            <p className="text-sm font-medium">{deck.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {t('cards_count', { count: deck.flashcard_count })}
                            </p>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="py-4 text-center text-sm text-muted-foreground">
                      {t('no_decks')}
                    </p>
                  )}
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>{t('review_mode_title')}</CardTitle>
                <CardDescription>{t('review_mode_desc')}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
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
                    {studyMode === 'endless'
                      ? t('mode_endless_desc')
                      : t('mode_limited_desc')}
                  </p>
                </div>

                {studyMode === 'limited' && (
                  <div className="flex flex-col gap-2">
                    <Label>{t('target_count_label', { count: targetCount })}</Label>
                    <Input
                      type="number"
                      min={1}
                      max={100}
                      value={targetCount}
                      onChange={(e) =>
                        setTargetCount(
                          Math.max(1, Math.min(100, parseInt(e.target.value) || 1)),
                        )
                      }
                      className="max-w-32"
                    />
                  </div>
                )}

                <div className="flex items-center justify-between">
                  <div className="text-sm text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {displayedCount > 0 ? (
                        <>
                          {displayedCount} {t('due_for_review')}
                        </>
                      ) : dueBreakdown?.nextReviewAt ? (
                        <>
                          {t('next_review_at')}{' '}
                          {new Date(dueBreakdown.nextReviewAt).toLocaleString('pl-PL', {
                            month: 'short',
                            day: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </>
                      ) : (
                        <>{t('due_for_review')}</>
                      )}
                    </span>
                    {isFiltered && <span className="ml-2">({t('filtered')})</span>}
                  </div>
                  <Button onClick={startReview}>
                    <Play data-icon="inline-start" /> {t('start_review')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </TabsContent>

      <TabsContent value="learn" className="flex flex-col gap-6 mt-0">
        {isLoading ? (
          <Card>
            <CardHeader>
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-64" />
            </CardHeader>
            <CardContent className="flex flex-col gap-6">
              <Skeleton className="h-4 w-full" />
              <div className="flex items-center justify-between">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-10 w-36" />
              </div>
            </CardContent>
          </Card>
        ) : remainingNew > 0 ? (
          <section className="flex flex-col gap-3">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Sparkles className="size-5" /> {t('remaining_title')}
            </h2>
            <p className="text-sm text-muted-foreground">{t('remaining_desc')}</p>
            <div className="flex flex-col gap-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">
                  {t('remaining_label', { remaining: remainingNew, total: newCardsPerDay })}
                </span>
                <span className="font-medium">{Math.round(newProgress)}%</span>
              </div>
              <Progress value={newProgress} />
            </div>
            <div className="flex items-center justify-between">
              <p className="text-sm text-muted-foreground">{t('remaining_desc')}</p>
              <Button onClick={startLearning}>
                <Play data-icon="inline-start" /> {t('start_learning')}
              </Button>
            </div>
          </section>
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Moon className="size-6" />
              </EmptyMedia>
              <EmptyTitle>{t('limit_reached')}</EmptyTitle>
              <EmptyDescription>{t('limit_reached_desc')}</EmptyDescription>
            </EmptyHeader>
          </Empty>
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
              <CramDeckCard
                key={deck.id}
                deck={deck}
                onStart={() => startCram(deck.id)}
                t={t}
              />
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
                <FieldLabel>{t('quiz_difficulty')}</FieldLabel>
                <FieldContent>
                  <Select value={quizDifficulty} onValueChange={setQuizDifficulty}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {DIFFICULTY_OPTIONS.map((opt) => (
                        <SelectItem key={opt.value} value={opt.value}>
                          {opt.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
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
                      setQuizCount(
                        Math.max(1, Math.min(50, parseInt(e.target.value) || 1)),
                      )
                    }
                  />
                </FieldContent>
              </Field>
            </FieldGroup>

            <Button className="mt-6 w-full" onClick={handleGenerateQuiz} disabled={quizSubmitting}>
              <ListChecks data-icon="inline-start" />
              {t('generate_quiz')}
            </Button>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="history" className="flex flex-col gap-6 mt-0">
        {attempts && attempts.length > 0 ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {attempts.map((attempt) => {
              const percentage = Math.round(
                (attempt.score / attempt.total_questions) * 100,
              );
              return (
                <Card key={attempt.id}>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <Badge
                        variant={attempt.completed_at ? 'default' : 'secondary'}
                      >
                        {attempt.completed_at ? 'Completed' : 'In Progress'}
                      </Badge>
                      <span className="text-2xl font-bold">{percentage}%</span>
                    </div>
                    <CardTitle className="text-base mt-2">
                      {`${attempt.score}/${attempt.total_questions} correct`}
                    </CardTitle>
                    <CardDescription>
                      {new Date(attempt.started_at).toLocaleDateString()}
                      {attempt.config?.difficulty && ` · ${attempt.config.difficulty}`}
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
