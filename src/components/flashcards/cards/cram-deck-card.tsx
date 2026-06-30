'use client';

import { Play } from 'lucide-react';
import type { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { getGradientHex } from '@/lib/color-utils';
import type { Deck } from '@/types/flashcards';

interface CramDeckCardProps {
  deck: Deck;
  onStart: () => void;
  t: ReturnType<typeof useTranslations>;
}

export function CramDeckCard({ deck, onStart, t }: CramDeckCardProps) {
  const gradientHex = getGradientHex(deck.id);

  return (
    <Card
      className="group cursor-pointer flex flex-col h-full overflow-hidden transition-all duration-300 ease-out sm:hover:-translate-y-1 sm:hover:shadow-lg sm:hover:border-primary/40 max-sm:py-0 min-w-0 p-0"
      onClick={onStart}
    >
      {/* Mobile: Compact row */}
      <div className="relative flex items-center justify-between gap-3 p-3.5 sm:hidden max-w-[calc(100vw-2rem)]">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="relative shrink-0">
            <div className="h-10 w-10 rounded-xl bg-muted/50 border border-border/40 shadow-sm flex items-center justify-center">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none">
                <defs>
                  <linearGradient id={`cram-mob-grad-${deck.id}`} x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor={gradientHex.from} />
                    <stop offset="100%" stopColor={gradientHex.to} />
                  </linearGradient>
                </defs>
                <path
                  d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"
                  stroke={`url(#cram-mob-grad-${deck.id})`}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </div>
          <div className="min-w-0 flex-1 space-y-0.5">
            <h3 className="text-[15px] font-bold tracking-tight text-foreground truncate">
              {deck.name}
            </h3>
            <div className="flex items-center gap-1.5 text-muted-foreground/80">
              <Badge
                variant="secondary"
                className="bg-secondary/40 text-secondary-foreground hover:bg-secondary/40 border-transparent text-[11px] font-medium leading-none px-1.5 py-0.5 shadow-none"
              >
                {t('flashcards_count', { count: deck.flashcard_count })}
              </Badge>
            </div>
          </div>
        </div>

        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 text-muted-foreground/80 hover:text-foreground shrink-0 -mr-1"
          onClick={(e) => {
            e.stopPropagation();
            onStart();
          }}
        >
          <Play className="h-4 w-4" />
        </Button>
      </div>

      {/* Desktop: Card grid item */}
      <div className="hidden sm:flex flex-col flex-1 p-5 relative">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          <div className="shrink-0">
            <div className="h-10 w-10 rounded-xl bg-muted/40 border border-border/50 shadow-sm flex items-center justify-center">
              <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none">
                <defs>
                  <linearGradient id={`cram-grad-${deck.id}`} x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor={gradientHex.from} />
                    <stop offset="100%" stopColor={gradientHex.to} />
                  </linearGradient>
                </defs>
                <path
                  d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"
                  stroke={`url(#cram-grad-${deck.id})`}
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </div>
          </div>
          <h3 className="text-lg font-bold tracking-tight text-foreground truncate min-w-0">
            {deck.name}
          </h3>
        </div>

        {deck.description && (
          <p className="text-sm text-muted-foreground/90 leading-relaxed line-clamp-2 mt-3">
            {deck.description}
          </p>
        )}

        <div className="flex-1" />

        <div className="mt-auto flex items-center justify-between pt-4">
          <Badge
            variant="secondary"
            className="bg-secondary/50 text-secondary-foreground hover:bg-secondary/70 border-transparent shadow-none font-medium px-2.5 py-0.5"
          >
            {t('flashcards_count', { count: deck.flashcard_count })}
          </Badge>

          <Button
            variant="ghost"
            size="sm"
            className="gap-1.5 text-primary hover:text-primary hover:bg-primary/10 font-semibold px-2 -mr-2 transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              onStart();
            }}
          >
            <Play className="h-4 w-4" /> {t('start_cram')}
          </Button>
        </div>
      </div>
    </Card>
  );
}
