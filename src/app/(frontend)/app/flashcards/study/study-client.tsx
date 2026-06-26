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
  BarChart3,
  BookOpen as _BookOpen,
  Dumbbell,
  Sparkles,
  Moon,
} from 'lucide-react';
import { useApiQuery } from '@/hooks/use-api';
import { flashcardKeys } from '@/lib/query-keys';
import { Progress } from '@/components/ui/progress';
import { CramDeckCard } from '@/components/flashcards/cards/cram-deck-card';
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

export default function StudyClient() {
  const t = useTranslations('AppFlashcardStudyPage');
  const router = useRouter();

  const { data: topicsData, isLoading: topicsLoading } = useApiQuery<{ items: Topic[]; nextCursor: string | null; hasMore: boolean }>({
    queryKey: flashcardKeys.topics.all,
    url: '/api/v1/flashcards/topics?limit=200',
  });
  const { data: decksData, isLoading: decksLoading } = useApiQuery<{ items: Deck[]; nextCursor: string | null; hasMore: boolean }>({
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

  const isLoading = topicsLoading || decksLoading || breakdownLoading || settingsLoading;

  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [selectedDecks, setSelectedDecks] = useState<string[]>([]);
  const [mode, setMode] = useState<'endless' | 'limited'>('endless');
  const [targetCount, setTargetCount] = useState(10);

  const isFiltered = selectedTopics.length > 0 || selectedDecks.length > 0;

  const displayedCount = isFiltered
    ? selectedTopics.reduce((sum, id) => sum + (dueBreakdown?.byTopic[id] ?? 0), 0) +
      selectedDecks.reduce((sum, id) => sum + (dueBreakdown?.byDeck[id] ?? 0), 0)
    : (dueBreakdown?.total ?? 0);

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

  function startReview() {
    const params = new URLSearchParams();
    params.set('mode', 'review');
    if (selectedTopics.length > 0) params.set('topics', selectedTopics.join(','));
    if (selectedDecks.length > 0) params.set('decks', selectedDecks.join(','));
    params.set('studyMode', mode);
    if (mode === 'limited') params.set('target', String(targetCount));
    router.push(`/app/flashcards/session?${params.toString()}`);
  }

  function startLearning() {
    const params = new URLSearchParams();
    params.set('mode', 'review');
    params.set('newOnly', 'true');
    params.set('studyMode', 'endless');
    router.push(`/app/flashcards/session?${params.toString()}`);
  }

  function startCram(deckId: string) {
    router.push(`/app/flashcards/session?mode=cram&deckId=${deckId}`);
  }

  const remainingNew = settings?.remainingNewCards ?? 0;
  const newCardsPerDay = settings?.newCardsPerDay ?? 20;
  const newProgress =
    newCardsPerDay > 0 ? ((newCardsPerDay - remainingNew) / newCardsPerDay) * 100 : 100;

  const FLAT_LAYOUT = true;

  return (
    <Tabs defaultValue="review" className="space-y-6">
      <div className="flex items-center justify-between">
        <TabsList>
          <TabsTrigger value="review" className="gap-2">
            <Play className="h-4 w-4" /> {t('tab_review_due')}
          </TabsTrigger>
          <TabsTrigger value="learn" className="gap-2">
            <Sparkles className="h-4 w-4" /> {t('tab_learn_new')}
          </TabsTrigger>
          <TabsTrigger value="cram" className="gap-2">
            <Dumbbell className="h-4 w-4" /> {t('tab_cram_deck')}
          </TabsTrigger>
        </TabsList>
        <Button variant="outline" size="sm" onClick={() => router.push('/app/flashcards/stats')}>
          <BarChart3 className="mr-2 h-4 w-4" /> {t('statistics')}
        </Button>
      </div>

      <TabsContent value="review" className="space-y-6 mt-0">
        {isLoading ? (
          <>
            <div className="grid gap-6 lg:grid-cols-2">
              <Card className="p-6">
                <Skeleton className="h-6 w-32 mb-2" />
                <Skeleton className="h-4 w-48 mb-6" />
                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full rounded-lg" />
                  ))}
                </div>
              </Card>
              <Card className="p-6">
                <Skeleton className="h-6 w-32 mb-2" />
                <Skeleton className="h-4 w-48 mb-6" />
                <div className="space-y-2">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-12 w-full rounded-lg" />
                  ))}
                </div>
              </Card>
            </div>
            <Card className="p-6">
              <Skeleton className="h-6 w-40 mb-2" />
              <Skeleton className="h-4 w-64 mb-6" />
              <div className="flex gap-4">
                <Skeleton className="h-20 flex-1 rounded-lg" />
                <Skeleton className="h-20 flex-1 rounded-lg" />
              </div>
              <div className="flex items-center justify-between pt-6">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-10 w-28" />
              </div>
            </Card>
          </>
        ) : (
          <>
            <div className="grid gap-6 lg:grid-cols-2">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Tags className="h-5 w-5" /> {t('topics_title')}
                  </CardTitle>
                  <CardDescription>{t('topics_desc')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {topics?.map((topic) => (
                      <div key={topic.id} className="flex items-center gap-3 p-3 rounded-lg border">
                        <Checkbox
                          checked={selectedTopics.includes(topic.id)}
                          onCheckedChange={() => toggleTopic(topic.id)}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{topic.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {t('cards_count', { count: topic.flashcard_count })}
                          </p>
                        </div>
                      </div>
                    ))}
                    {(!topics || topics.length === 0) && (
                      <p className="text-center py-4 text-muted-foreground text-sm">
                        {t('no_topics')}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <FolderOpen className="h-5 w-5" /> {t('decks_title')}
                  </CardTitle>
                  <CardDescription>{t('decks_desc')}</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {decks?.map((deck) => (
                      <div key={deck.id} className="flex items-center gap-3 p-3 rounded-lg border">
                        <Checkbox
                          checked={selectedDecks.includes(deck.id)}
                          onCheckedChange={() => toggleDeck(deck.id)}
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">{deck.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {t('cards_count', { count: deck.flashcard_count })}
                          </p>
                        </div>
                      </div>
                    ))}
                    {(!decks || decks.length === 0) && (
                      <p className="text-center py-4 text-muted-foreground text-sm">
                        {t('no_decks')}
                      </p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>{t('review_mode_title')}</CardTitle>
                <CardDescription>{t('review_mode_desc')}</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex gap-4">
                  <button
                    type="button"
                    className={`flex-1 p-4 rounded-lg border-2 text-left transition-colors ${
                      mode === 'endless' ? 'border-primary bg-primary/5' : 'border-border'
                    }`}
                    onClick={() => setMode('endless')}
                  >
                    <p className="font-medium">{t('mode_endless')}</p>
                    <p className="text-sm text-muted-foreground">{t('mode_endless_desc')}</p>
                  </button>
                  <button
                    type="button"
                    className={`flex-1 p-4 rounded-lg border-2 text-left transition-colors ${
                      mode === 'limited' ? 'border-primary bg-primary/5' : 'border-border'
                    }`}
                    onClick={() => setMode('limited')}
                  >
                    <p className="font-medium">{t('mode_limited')}</p>
                    <p className="text-sm text-muted-foreground">{t('mode_limited_desc')}</p>
                  </button>
                </div>

                {mode === 'limited' && (
                  <div>
                    <Label>{t('target_count_label', { count: targetCount })}</Label>
                    <Input
                      type="number"
                      min={1}
                      max={100}
                      value={targetCount}
                      onChange={(e) =>
                        setTargetCount(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))
                      }
                      className="mt-2 max-w-32"
                    />
                  </div>
                )}

                <div className="flex items-center justify-between pt-2">
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
                    <Play className="mr-2 h-4 w-4" /> {t('start_review')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </TabsContent>

      <TabsContent value="learn" className="space-y-6 mt-0">
        {isLoading ? (
          <Card className="p-6">
            <Skeleton className="h-6 w-48 mb-4" />
            <Skeleton className="h-4 w-64 mb-8" />
            <Skeleton className="h-4 w-full mb-6" />
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-32" />
              <Skeleton className="h-10 w-36" />
            </div>
          </Card>
        ) : FLAT_LAYOUT ? (
          <section className="space-y-3">
            <h2 className="flex items-center gap-2 text-lg font-semibold">
              <Sparkles className="h-5 w-5" /> {t('remaining_title')}
            </h2>
            <p className="text-sm text-muted-foreground">{t('remaining_desc')}</p>
            {remainingNew > 0 ? (
              <div className="space-y-6">
                <div className="space-y-3">
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
                    <Play className="mr-2 h-4 w-4" /> {t('start_learning')}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="text-center py-12">
                <Moon className="mx-auto h-12 w-12 text-muted-foreground/40 mb-4" />
                <p className="text-muted-foreground">{t('limit_reached')}</p>
              </div>
            )}
          </section>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Sparkles className="h-5 w-5" /> {t('remaining_title')}
              </CardTitle>
              <CardDescription>{t('remaining_desc')}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {remainingNew > 0 ? (
                <>
                  <div className="space-y-3">
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
                      <Play className="mr-2 h-4 w-4" /> {t('start_learning')}
                    </Button>
                  </div>
                </>
              ) : (
                <div className="text-center py-8">
                  <p className="text-muted-foreground">{t('limit_reached')}</p>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </TabsContent>

      <TabsContent value="cram" className="space-y-6 mt-0">
        <p className="text-muted-foreground">{t('deck_picker_desc')}</p>

        {isLoading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="flex flex-col h-full max-sm:py-0 min-w-0">
                {/* Mobile skeleton */}
                <div className="flex items-center gap-3 p-4 sm:hidden">
                  <Skeleton className="h-10 w-10 rounded-xl shrink-0" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-1/2" />
                    <Skeleton className="h-3 w-1/4" />
                  </div>
                  <Skeleton className="h-7 w-7 rounded-md shrink-0" />
                </div>
                {/* Desktop skeleton */}
                <div className="hidden sm:flex flex-col h-full p-5 space-y-4">
                  <div className="flex items-center gap-3">
                    <Skeleton className="h-10 w-10 rounded-xl" />
                    <Skeleton className="h-6 w-3/4" />
                  </div>
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-4 w-4/5" />
                  </div>
                  <div className="flex items-center justify-between pt-4 mt-auto">
                    <Skeleton className="h-6 w-16 rounded-full" />
                    <Skeleton className="h-8 w-24 rounded-md" />
                  </div>
                </div>
              </Card>
            ))}
          </div>
        ) : (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {decks?.map((deck) => (
              <CramDeckCard
                key={deck.id}
                deck={deck}
                onStart={() => startCram(deck.id)}
                t={t}
              />
            ))}
            {(!decks || decks.length === 0) && (
              <div className="col-span-full text-center py-12 text-muted-foreground">
                {t('no_decks_picker')}
              </div>
            )}
          </div>
        )}
      </TabsContent>
    </Tabs>
  );
}
