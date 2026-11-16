'use client';

import { Badge } from '@studiq/ui';
import { Check, Layers, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/** One generated card, as the chat result carries it. */
export interface FlashcardData {
  front: string;
  back: string;
  topic?: string;
}

interface GeneratedCardsProps {
  cards: readonly FlashcardData[];
  /** The line above the tiles, already interpolated: „Wygenerowano 6 fiszek”. */
  label: string;
  /** After the label: the removed count, or the read-only marker. */
  note?: ReactNode;
  /** Indices the visitor marked out; the tile dims but stays readable. */
  removed?: ReadonlySet<number>;
  /**
   * Absent where the cards are evidence rather than an editable set: the tiles
   * then carry no control at all. The chat always passes it.
   */
  onToggleCard?: (index: number) => void;
  toggleLabels?: { remove: string; keep: string };
}

/**
 * The generated cards under an assistant message, extracted from the chat so a
 * page can render the same tiles from fixtures (DESIGN §Product imagery).
 *
 * The list is capped in the chat: a long generation must not push the
 * conversation off the screen. A page has no conversation to protect, and the
 * fixtures are short enough that the cap never engages, so the same box is
 * handed over without a second layout.
 */
export function GeneratedCards({
  cards,
  label,
  note,
  removed,
  onToggleCard,
  toggleLabels,
}: GeneratedCardsProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <Layers className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
        <span className="text-xs font-medium text-muted-foreground">{label}</span>
        {note}
      </div>

      <div className="max-h-112 overflow-y-auto -mx-1 px-1">
        <div className="grid grid-cols-2 gap-2">
          {cards.map((card, index) => {
            const isRemoved = removed?.has(index) ?? false;
            return (
              <div
                key={`${card.front}-${index}`}
                className={cn(
                  'group relative rounded-lg border bg-background/60 p-2.5 text-xs transition-opacity',
                  isRemoved && 'opacity-30',
                )}
              >
                {onToggleCard && toggleLabels && (
                  <button
                    type="button"
                    onClick={() => onToggleCard(index)}
                    className={cn(
                      'absolute top-1.5 right-1.5 rounded-md p-1 transition-colors',
                      isRemoved
                        ? 'bg-green-500/10 text-green-500 hover:text-green-600'
                        : 'text-muted-foreground/40 opacity-0 hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100',
                    )}
                    title={isRemoved ? toggleLabels.keep : toggleLabels.remove}
                  >
                    {isRemoved ? (
                      <Check className="h-3 w-3" aria-hidden />
                    ) : (
                      <Trash2 className="h-3 w-3" aria-hidden />
                    )}
                  </button>
                )}

                <div className="pr-5 font-medium">{card.front}</div>
                <div className="mt-0.5 text-muted-foreground">{card.back}</div>
                {card.topic && (
                  <Badge variant="secondary" className="mt-1 px-1.5 py-0 text-[10px]">
                    {card.topic}
                  </Badge>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
