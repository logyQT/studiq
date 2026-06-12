'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Play, ArrowLeft, FolderOpen, Tags, BarChart3 } from 'lucide-react';
import { useApiQuery } from '@/hooks/use-api';
import { flashcardKeys } from '@/lib/query-keys';
import { Skeleton } from '@/components/ui/skeleton';

interface Topic {
  id: string;
  name: string;
  flashcard_count: number;
}

interface Deck {
  id: string;
  name: string;
  description: string | null;
  flashcard_count: number;
}

interface DueBreakdown {
  total: number;
  byTopic: Record<string, number>;
  byDeck: Record<string, number>;
}

export default function StudyClient() {
  const t = useTranslations('AppFlashcardStudyPage');
  const router = useRouter();

  const { data: topics, isLoading: topicsLoading } = useApiQuery<Topic[]>({
    queryKey: flashcardKeys.topics.all,
    url: '/api/v1/flashcards/topics',
  });
  const { data: decks, isLoading: decksLoading } = useApiQuery<Deck[]>({
    queryKey: flashcardKeys.decks.all,
    url: '/api/v1/flashcards/decks',
  });
  const { data: dueBreakdown, isLoading: breakdownLoading } = useApiQuery<DueBreakdown>({
    queryKey: flashcardKeys.practice.dueBreakdown,
    url: '/api/v1/flashcards/practice/due/breakdown',
  });

  const isLoading = topicsLoading || decksLoading || breakdownLoading;

  const [selectedTopics, setSelectedTopics] = useState<string[]>([]);
  const [selectedDecks, setSelectedDecks] = useState<string[]>([]);
  const [mode, setMode] = useState<'endless' | 'limited'>('endless');
  const [targetCount, setTargetCount] = useState(10);

  const isFiltered = selectedTopics.length > 0 || selectedDecks.length > 0;

  const displayedCount = isFiltered
    ? selectedTopics.reduce((sum, id) => sum + ((dueBreakdown?.byTopic[id] ?? 0)), 0) +
      selectedDecks.reduce((sum, id) => sum + ((dueBreakdown?.byDeck[id] ?? 0)), 0)
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

  function startSession() {
    const params = new URLSearchParams();
    params.set('mode', 'study');
    if (selectedTopics.length > 0) params.set('topics', selectedTopics.join(','));
    if (selectedDecks.length > 0) params.set('decks', selectedDecks.join(','));
    params.set('studyMode', mode);
    if (mode === 'limited') params.set('target', String(targetCount));

    router.push(`/app/flashcards/session?${params.toString()}`);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/app/flashcards">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" /> {t('back')}
          </Button>
        </Link>
        <h2 className="text-2xl font-bold">{t('title')}</h2>
        <div className="ml-auto">
          <Link href="/app/flashcards/statistics">
            <Button variant="outline" size="sm">
              <BarChart3 className="mr-2 h-4 w-4" /> {t('statistics')}
            </Button>
          </Link>
        </div>
      </div>

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
                    <p className="text-center py-4 text-muted-foreground text-sm">{t('no_topics')}</p>
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
                    <p className="text-center py-4 text-muted-foreground text-sm">{t('no_decks')}</p>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>{t('study_mode_title')}</CardTitle>
              <CardDescription>{t('study_mode_desc')}</CardDescription>
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
                    {displayedCount} {t('due_for_review')}
                  </span>
                  {isFiltered && <span className="ml-2">({t('filtered')})</span>}
                </div>
                <Button onClick={startSession}>
                  <Play className="mr-2 h-4 w-4" /> {t('start_study')}
                </Button>
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
