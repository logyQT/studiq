'use client';

import { FolderOpen } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { CramDeckCard } from '@/components/flashcards/cards/cram-deck-card';
import { Card } from '@/components/ui/card';
import { Empty, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { useApiQuery } from '@/hooks/use-api';
import { flashcardKeys } from '@/lib/query-keys';
import type { Deck } from '@/types/flashcards';

export function CramContent() {
  const t = useTranslations('AppFlashcardStudyPage');
  const router = useRouter();

  const { data: decksData, isLoading } = useApiQuery<{
    items: Deck[];
    nextCursor: string | null;
    hasMore: boolean;
  }>({
    queryKey: flashcardKeys.decks.all,
    url: '/api/v1/flashcards/decks?limit=200',
  });
  const decks = decksData?.items;

  function startCram(deckId: string) {
    router.push(`/app/study/session/cram?deckId=${deckId}`);
  }

  return (
    <div className="flex flex-col gap-6">
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
    </div>
  );
}
