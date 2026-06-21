'use client';

import { useState, useMemo } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BarChart3, Layers, Sparkles, Filter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Empty, EmptyHeader, EmptyTitle, EmptyMedia } from '@/components/ui/empty';
import { DeckDetailSkeleton } from '@/components/flashcards/deck-detail-skeleton';
import { MultiSelect } from '@/components/ui/multi-select';
import { channel, useRealtimeChannel } from '@/hooks/use-realtime-channel';
import { MarkdownRenderer } from '@/components/shared/markdown-renderer';
import { useApiQuery } from '@/hooks/use-api';
import { flashcardKeys } from '@/lib/query-keys';
import type { DifficultyFlashcardDetail } from '@/server/models';

type NamedItem = { id: string; name: string };

export default function DifficultyBucketClient() {
  const params = useParams();
  const bucket = params.bucket as string;
  const t = useTranslations('DifficultyPage');
  const queryClient = useQueryClient();
  const [deckIds, setDeckIds] = useState<string[]>([]);
  const [topicIds, setTopicIds] = useState<string[]>([]);

  const deckOpts = useApiQuery<NamedItem[]>({
    queryKey: ['flashcards', 'decks'],
    url: '/api/v1/flashcards/decks',
  });

  const topicOpts = useApiQuery<NamedItem[]>({
    queryKey: ['flashcards', 'topics'],
    url: '/api/v1/flashcards/topics',
  });

  const { data, isLoading } = useApiQuery<DifficultyFlashcardDetail[]>({
    queryKey: flashcardKeys.stats.difficultyBucket(bucket),
    url: `/api/v1/flashcards/stats/teacher/difficulty/${bucket}`,
  });

  const filteredData = useMemo(() => {
    if (!data) return undefined;
    return data.filter((card) => {
      if (deckIds.length > 0 && !deckIds.some((id) => card.deckIds.includes(id))) return false;
      if (topicIds.length > 0 && !topicIds.some((id) => card.topicIds.includes(id))) return false;
      return true;
    });
  }, [data, deckIds, topicIds]);

  useRealtimeChannel(
    channel(`difficulty-${bucket}`)
      .listen('flashcard_practice', () => { queryClient.invalidateQueries({ queryKey: flashcardKeys.stats.difficultyBucket(bucket) }); })
      .listen('flashcard_review_state', () => { queryClient.invalidateQueries({ queryKey: flashcardKeys.stats.difficultyBucket(bucket) }); }),
  );

  const titleKey = `title_${bucket}` as 'title_easy' | 'title_medium' | 'title_hard' | 'title_new';

  if (isLoading) return <DeckDetailSkeleton />;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Link href="/edu/flashcards/stats">
          <Button variant="ghost" size="sm">
            <ArrowLeft className="mr-2 h-4 w-4" /> {t('back')}
          </Button>
        </Link>
        <h2 className="text-2xl font-bold">{t(titleKey)}</h2>
        {filteredData && (
          <span className="text-muted-foreground text-sm">({filteredData.length})</span>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Filter className="h-4 w-4 text-muted-foreground" />
        <MultiSelect
          options={(deckOpts.data ?? []).map((d) => ({ label: d.name, value: d.id }))}
          selected={deckIds}
          onChange={setDeckIds}
          placeholder={t('filterDecks')}
          className="max-w-xs"
        />
        <MultiSelect
          options={(topicOpts.data ?? []).map((t) => ({ label: t.name, value: t.id }))}
          selected={topicIds}
          onChange={setTopicIds}
          placeholder={t('filterTopics')}
          className="max-w-xs"
        />
        {(deckIds.length > 0 || topicIds.length > 0) && (
          <Button variant="ghost" size="sm" onClick={() => { setDeckIds([]); setTopicIds([]); }}>
            {t('clearFilters')}
          </Button>
        )}
      </div>

      {!filteredData || filteredData.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia>
              <BarChart3 className="h-10 w-10 text-muted-foreground" />
            </EmptyMedia>
            <EmptyTitle>{t('empty')}</EmptyTitle>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {filteredData.map((fc) => (
            <Card key={fc.id} className="flex flex-col">
              <CardContent className="p-5 flex flex-col gap-3 flex-1">
                <div className="space-y-1.5 min-h-0">
                  <p className="text-sm font-medium leading-snug line-clamp-2"><MarkdownRenderer content={fc.front} /></p>
                  <p className="text-sm text-muted-foreground leading-snug line-clamp-2"><MarkdownRenderer content={fc.back} /></p>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {fc.deckNames.map((name) => (
                    <Badge key={name} variant="secondary" className="text-xs">
                      <Layers className="mr-1 h-3 w-3" />
                      {name}
                    </Badge>
                  ))}
                  {fc.topicNames.map((name) => (
                    <Badge key={name} variant="outline" className="text-xs">
                      <Sparkles className="mr-1 h-3 w-3" />
                      {name}
                    </Badge>
                  ))}
                </div>

                <div className="mt-auto pt-2 border-t grid grid-cols-3 gap-2 text-center text-xs text-muted-foreground">
                  <div>
                    <p className="font-medium text-sm text-foreground tabular-nums">
                      {bucket === 'new' ? '—' : `${fc.accuracy}%`}
                    </p>
                    <p>{t('accuracy')}</p>
                  </div>
                  <div>
                    <p className="font-medium text-sm text-foreground tabular-nums">
                      {fc.totalAttempts}
                    </p>
                    <p>{t('attempts')}</p>
                  </div>
                  <div>
                    <p className="font-medium text-sm text-foreground tabular-nums">
                      {fc.studentCount}
                    </p>
                    <p>{t('students')}</p>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
