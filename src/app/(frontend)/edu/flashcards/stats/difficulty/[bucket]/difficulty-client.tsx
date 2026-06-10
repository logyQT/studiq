'use client';

import { useRef, useCallback } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, BarChart3, Layers, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Empty, EmptyHeader, EmptyTitle, EmptyDescription, EmptyMedia } from '@/components/ui/empty';
import { DeckDetailSkeleton } from '@/components/flashcards/deck-detail-skeleton';
import { channel, useRealtimeChannel } from '@/hooks/use-realtime-channel';
import type { DifficultyFlashcardDetail } from '@/server/models';

export default function DifficultyBucketClient() {
  const params = useParams();
  const bucket = params.bucket as string;
  const t = useTranslations('DifficultyPage');
  const statsT = useTranslations('EduFlashcardStatsPage');
  const queryClient = useQueryClient();
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const { data, isLoading } = useQuery<DifficultyFlashcardDetail[]>({
    queryKey: ['difficultyCards', bucket],
    queryFn: async () => {
      const res = await fetch(`/api/v1/flashcards/stats/teacher/difficulty/${bucket}`);
      const json = await res.json();
      return json.data as DifficultyFlashcardDetail[];
    },
  });

  const invalidateWithDebounce = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      queryClient.invalidateQueries({ queryKey: ['difficultyCards', bucket] });
    }, 10000);
  }, [queryClient, bucket]);

  useRealtimeChannel(
    channel(`difficulty-${bucket}`)
      .listen('flashcard_practice', invalidateWithDebounce)
      .listen('flashcard_review_state', invalidateWithDebounce),
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
        {data && (
          <span className="text-muted-foreground text-sm">({data.length})</span>
        )}
      </div>

      {!data || data.length === 0 ? (
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
          {data.map((fc) => (
            <Card key={fc.id} className="flex flex-col">
              <CardContent className="p-5 flex flex-col gap-3 flex-1">
                <div className="space-y-1.5 min-h-0">
                  <p className="text-sm font-medium leading-snug line-clamp-2">{fc.front}</p>
                  <p className="text-sm text-muted-foreground leading-snug line-clamp-2">{fc.back}</p>
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
