'use client';

import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Play, BarChart3 } from 'lucide-react';
import { Breadcrumbs } from '@/components/layout/breadcrumbs';
import { useApiQuery } from '@/hooks/use-api';
import { flashcardKeys } from '@/lib/query-keys';
import type { Deck } from '@/types/flashcards';

const GRADIENTS = [
  'from-violet-500 to-purple-600',
  'from-blue-500 to-cyan-500',
  'from-emerald-500 to-teal-600',
  'from-orange-500 to-amber-600',
  'from-pink-500 to-rose-600',
  'from-indigo-500 to-blue-600',
  'from-fuchsia-500 to-pink-600',
  'from-lime-500 to-green-600',
  'from-red-500 to-orange-500',
  'from-sky-500 to-indigo-500',
  'from-yellow-500 to-orange-500',
  'from-teal-500 to-emerald-600',
];

function getGradient(id: string) {
  let hash = 0;
  for (let i = 0; i < id.length; i++) {
    hash = id.charCodeAt(i) + ((hash << 5) - hash);
  }
  return GRADIENTS[Math.abs(hash) % GRADIENTS.length];
}

export default function PracticeClient() {
  const t = useTranslations('AppFlashcardPracticePage');
  const navT = useTranslations('AppFlashcardsPage');
  const router = useRouter();

  const { data: decks, isLoading } = useApiQuery<Deck[]>({
    queryKey: flashcardKeys.decks.all,
    url: '/api/v1/flashcards/decks',
  });

  function startPractice(deckId: string) {
    router.push(`/app/flashcards/session?mode=practice&deckId=${deckId}`);
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <Breadcrumbs items={[
          { label: navT('title'), href: '/app/flashcards' },
          { label: navT('practice_title'), href: '/app/flashcards/practice' },
        ]} />
        <Link href="/app/flashcards/statistics">
          <Button variant="outline" size="sm">
            <BarChart3 className="mr-2 h-4 w-4" /> {t('statistics')}
          </Button>
        </Link>
      </div>

      <p className="text-muted-foreground">{t('deck_picker_desc')}</p>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i} className="overflow-hidden p-0">
              <Skeleton className="h-20 w-full rounded-none" />
              <div className="p-5 space-y-3">
                <Skeleton className="h-5 w-3/4" />
                <Skeleton className="h-4 w-1/2" />
                <div className="flex items-center justify-between pt-2">
                  <Skeleton className="h-5 w-20" />
                  <Skeleton className="h-9 w-24" />
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {decks?.map((deck) => {
            const gradient = getGradient(deck.id);
            return (
              <Card
                key={deck.id}
                className="group overflow-hidden cursor-pointer transition-all duration-200 hover:scale-[1.02] hover:shadow-lg hover:border-primary/50 p-0"
                onClick={() => startPractice(deck.id)}
              >
                <div
                  className={`h-20 bg-gradient-to-br ${gradient} flex items-center justify-center`}
                >
                  <span className="text-2xl font-bold text-white/90">
                    {deck.name.charAt(0).toUpperCase()}
                  </span>
                </div>
                <div className="p-5 pb-3">
                  <div className="flex items-start justify-between">
                    <div className="min-w-0">
                      <h3 className="text-lg font-semibold truncate">{deck.name}</h3>
                      {deck.description && (
                        <p className="text-sm text-muted-foreground line-clamp-2 mt-0.5">
                          {deck.description}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
                <div className="px-5 pb-5 flex items-center justify-between">
                  <Badge variant="secondary">
                    {t('flashcards_count', { count: deck.flashcard_count })}
                  </Badge>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="gap-1"
                    onClick={(e) => {
                      e.stopPropagation();
                      startPractice(deck.id);
                    }}
                  >
                    <Play className="h-3 w-3" /> {t('start_practice')}
                  </Button>
                </div>
              </Card>
            );
          })}
          {(!decks || decks.length === 0) && (
            <div className="col-span-full text-center py-12 text-muted-foreground">
              {t('no_decks_picker')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
