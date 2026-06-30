'use client';

import { ArrowRight, Eye, MoreVertical } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { useTranslations } from 'next-intl';
import { memo } from 'react';
import { DeckContextMenu } from '@/components/flashcards/context-menus/deck-context-menu';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { getGradientHex } from '@/lib/color-utils';
import type { Deck } from '@/types/flashcards';

interface DeckCardProps {
  deck: Deck;
  isSelecting: boolean;
  isSelected: boolean;
  onToggleSelect: () => void;
  basePath: string;
  t: ReturnType<typeof useTranslations>;
  canUpdate: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onExport: () => void;
  onSelect: () => void;
  onToggleSuspend: () => void;
}

export const DeckCard = memo(
  function DeckCard({
    deck,
    isSelecting,
    isSelected,
    onToggleSelect,
    basePath,
    t,
    canUpdate,
    canDelete,
    onEdit,
    onDelete,
    onExport,
    onSelect,
    onToggleSuspend,
  }: DeckCardProps) {
    const router = useRouter();
    const gradientHex = getGradientHex(deck.id);

    return (
      <Card
        className={`group cursor-pointer flex flex-col h-full overflow-hidden transition-all duration-300 ease-out sm:hover:-translate-y-1 sm:hover:shadow-lg sm:hover:border-primary/40 ${
          isSelected ? 'ring-2 ring-primary border-transparent' : ''
        } ${deck.suspended ? 'opacity-60 saturate-50' : ''} max-sm:py-0 min-w-0 p-0`}
        onClick={() => {
          if (isSelecting) {
            onToggleSelect();
          } else {
            router.push(`${basePath}/decks/${deck.id}`);
          }
        }}
      >
        {/* Mobile: Compact row */}
        <div className="relative flex items-center justify-between gap-3 p-3.5 sm:hidden max-w-[calc(100vw-2rem)]">
          {isSelecting && (
            <div className="absolute top-4 right-4 z-10">
              <Checkbox
                checked={isSelected}
                onCheckedChange={onToggleSelect}
                className="h-4 w-4 bg-background/90 border-muted-foreground/40 shadow-sm"
              />
            </div>
          )}
          <div className="flex items-center gap-3 min-w-0 flex-1">
            <div className="relative shrink-0">
              <div className="h-10 w-10 rounded-xl bg-muted/50 border border-border/40 shadow-sm flex items-center justify-center">
                <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none">
                  <defs>
                    <linearGradient id={`mob-grad-${deck.id}`} x1="0" y1="0" x2="1" y2="1">
                      <stop offset="0%" stopColor={gradientHex.from} />
                      <stop offset="100%" stopColor={gradientHex.to} />
                    </linearGradient>
                  </defs>
                  <path
                    d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"
                    stroke={`url(#mob-grad-${deck.id})`}
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
                {deck.suspended && (
                  <Badge
                    variant="outline"
                    className="text-[11px] font-medium leading-none px-1.5 py-0.5 border-dashed text-muted-foreground"
                  >
                    {t('suspended')}
                  </Badge>
                )}
                {!canUpdate && (
                  <span className="flex items-center text-[11px] text-muted-foreground/60 gap-0.5 font-medium ml-0.5">
                    <Eye className="h-3 w-3" /> {t('view_deck')}
                  </span>
                )}
              </div>
            </div>
          </div>

          {!isSelecting ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-muted-foreground/80 hover:text-foreground shrink-0 -mr-1"
                >
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DeckContextMenu
                  t={t}
                  canUpdate={canUpdate}
                  canDelete={canDelete}
                  suspended={deck.suspended ?? false}
                  onSelect={() => {
                    onSelect();
                    onToggleSelect();
                  }}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onExport={onExport}
                  onToggleSuspend={onToggleSuspend}
                />
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <div className="w-5 shrink-0" />
          )}
        </div>

        {/* Desktop: Card grid item */}
        <div className="hidden sm:flex flex-col flex-1 p-5 relative">
          {isSelecting && (
            <div className="absolute top-4 right-4 z-10">
              <Checkbox
                checked={isSelected}
                onCheckedChange={onToggleSelect}
                className="h-4 w-4 bg-background/80 shadow-sm"
              />
            </div>
          )}

          <div className="flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0 flex-1">
              <div className="shrink-0">
                <div className="h-10 w-10 rounded-xl bg-muted/40 border border-border/50 shadow-sm flex items-center justify-center">
                  <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none">
                    <defs>
                      <linearGradient id={`deck-grad-${deck.id}`} x1="0" y1="0" x2="1" y2="1">
                        <stop offset="0%" stopColor={gradientHex.from} />
                        <stop offset="100%" stopColor={gradientHex.to} />
                      </linearGradient>
                    </defs>
                    <path
                      d="m6 14 1.5-2.9A2 2 0 0 1 9.24 10H20a2 2 0 0 1 1.94 2.5l-1.54 6a2 2 0 0 1-1.95 1.5H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h3.9a2 2 0 0 1 1.69.9l.81 1.2a2 2 0 0 0 1.67.9H18a2 2 0 0 1 2 2v2"
                      stroke={`url(#deck-grad-${deck.id})`}
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

            {!isSelecting && (
              <div className="opacity-0 group-hover:opacity-100 transition-opacity shrink-0 -mr-2">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-foreground"
                    >
                      <MoreVertical className="h-4 w-4" />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DeckContextMenu
                      t={t}
                      canUpdate={canUpdate}
                      canDelete={canDelete}
                      suspended={deck.suspended ?? false}
                      onSelect={() => {
                        onSelect();
                        onToggleSelect();
                      }}
                      onEdit={onEdit}
                      onDelete={onDelete}
                      onExport={onExport}
                      onToggleSuspend={onToggleSuspend}
                    />
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            )}
          </div>

          <div className="mt-3 mb-4 flex-1">
            {deck.description && (
              <p className="text-sm text-muted-foreground/90 leading-relaxed line-clamp-2">
                {deck.description}
              </p>
            )}
          </div>

          <div className="mt-auto flex items-center justify-between pt-1">
            <div className="flex items-center gap-2">
              <Badge
                variant="secondary"
                className="bg-secondary/50 text-secondary-foreground hover:bg-secondary/70 border-transparent shadow-none font-medium px-2.5 py-0.5"
              >
                {t('flashcards_count', { count: deck.flashcard_count })}
              </Badge>
              {deck.suspended && (
                <Badge
                  variant="outline"
                  className="font-medium px-2.5 py-0.5 border-dashed text-muted-foreground"
                >
                  {t('suspended')}
                </Badge>
              )}
            </div>

            <Button
              variant="ghost"
              size="sm"
              className="gap-1.5 text-primary hover:text-primary hover:bg-primary/10 font-semibold px-2 -mr-2 transition-colors"
              onClick={(e) => {
                e.stopPropagation();
                router.push(`${basePath}/decks/${deck.id}`);
              }}
            >
              {canUpdate ? t('manage_deck') : t('view_deck')}
              {canUpdate ? <ArrowRight className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </Card>
    );
  },
  (prev, next) => {
    return (
      prev.deck.id === next.deck.id &&
      prev.deck.flashcard_count === next.deck.flashcard_count &&
      prev.deck.name === next.deck.name &&
      prev.deck.description === next.deck.description &&
      prev.deck.suspended === next.deck.suspended &&
      prev.isSelecting === next.isSelecting &&
      prev.isSelected === next.isSelected
    );
  },
);
