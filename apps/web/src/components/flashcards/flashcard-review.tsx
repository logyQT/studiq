'use client';

import { Button } from '@studiq/ui';
import { Check, Minus, X, Zap } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import type { ReactNode } from 'react';
import { FlashcardFlip } from '@/components/flashcards/flashcard-flip';
import { cn } from '@/lib/utils';

export interface FlashcardReviewRatingLabels {
  again: string;
  hard: string;
  good: string;
  easy: string;
}

export interface FlashcardReviewProps {
  /**
   * Card identity. A new value animates the outgoing card away and the next one
   * in. The session passes the card row id; the marketing preview passes the
   * fixture id, so a rated fixture leaves and the next mounts instead of swapping
   * content under the faces mid-fade.
   */
  cardKey: string;
  /**
   * The card faces. The session passes the product's markdown renderer; the
   * marketing preview passes fixture text. Keeping the renderer out of this
   * component keeps its module graph (and the landing bundle) off markdown and
   * KaTeX, which no marketing fixture needs.
   */
  front: ReactNode;
  back: ReactNode;
  isFlipped: boolean;
  onFlip: () => void;
  ariaLabel: string;
  /**
   * The reveal hint under the card. Hidden once the answer is up, or kept as an
   * empty line when `reserveHint` is set.
   */
  hint: string;
  /**
   * Keep the hint's line box in the layout while the answer is up. The study
   * session lets the card area grow into the freed line; the marketing band
   * cannot, because the ledger below it would jump by the hint's height on
   * every flip. Off by default, so the session's layout is unchanged.
   */
  reserveHint?: boolean;
  /** Caller-owned lines between the hint and the ratings: step, next review. */
  progress?: ReactNode;
  ratingLabels: FlashcardReviewRatingLabels;
  /** 1 = again, 2 = hard, 3 = good, 4 = easy — the product's confidence levels. */
  onRate: (confidenceLevel: 1 | 2 | 3 | 4) => void;
  /**
   * Side the outgoing card leaves on, chosen by the rating the student gave.
   * Only meaningful when `cardKey` changes between renders.
   */
  exitDirection?: 'left' | 'right';
}

/**
 * The review card as the student faces it: the flip card, the reveal hint (or the
 * caller's progress lines) and the four rating buttons.
 *
 * It is presentation only. The study session owns the queue, the scheduling and
 * the batch write, and the marketing page renders the same component from fixture
 * data (DESIGN.md §Product imagery). Neither caller may grow behaviour here: the
 * point of the extraction is that both run the identical markup.
 */
export function FlashcardReview({
  cardKey,
  front,
  back,
  isFlipped,
  onFlip,
  ariaLabel,
  hint,
  reserveHint = false,
  progress,
  ratingLabels,
  onRate,
  exitDirection = 'right',
}: FlashcardReviewProps) {
  return (
    <>
      <AnimatePresence mode="wait" custom={exitDirection}>
        <motion.div
          key={cardKey}
          custom={exitDirection}
          variants={{
            initial: (direction: string) => ({
              rotate: -10,
              y: 60,
              opacity: 0,
              transformOrigin: direction === 'left' ? 'left center' : 'right center',
            }),
            animate: (direction: string) => ({
              rotate: 0,
              y: 0,
              opacity: 1,
              transformOrigin: direction === 'left' ? 'left center' : 'right center',
            }),
            exit: (direction: string) => ({
              rotate: direction === 'left' ? -15 : 15,
              x: direction === 'left' ? -200 : 80,
              opacity: 0,
              transformOrigin: direction === 'left' ? 'left center' : 'right center',
              transition: { duration: direction === 'left' ? 0.2 : 0.15, ease: 'easeIn' },
            }),
          }}
          initial="initial"
          animate="animate"
          exit="exit"
          transition={{
            type: 'spring',
            stiffness: 300,
            damping: 25,
          }}
        >
          <FlashcardFlip
            isFlipped={isFlipped}
            onClick={onFlip}
            ariaLabel={ariaLabel}
            className="cursor-pointer max-h-[32rem]"
            front={
              <>
                <div
                  aria-hidden="true"
                  className="pointer-events-none absolute inset-0 z-0 flex items-center justify-center overflow-hidden"
                >
                  <div className="flex h-[200%] w-[200%] rotate-[45deg] flex-col items-center justify-center gap-y-16 opacity-[0.02]">
                    {Array.from({ length: 24 }).map((_, rowIndex) => (
                      <div
                        key={rowIndex}
                        className={cn(
                          'flex items-center gap-x-16',
                          rowIndex % 2 === 0 ? 'translate-x-8' : '',
                        )}
                      >
                        {Array.from({ length: 24 }).map((_col, colIndex) => (
                          <span
                            key={colIndex}
                            className="-rotate-45 text-5xl font-bold select-none"
                          >
                            ?
                          </span>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>

                <div className="relative z-10 flex w-full flex-1 items-center justify-center overflow-y-auto px-8 text-center text-2xl font-medium">
                  {front}
                </div>
              </>
            }
            back={
              <>
                <div className="pointer-events-none absolute inset-0 z-0 overflow-hidden" />
                <div className="relative z-10 flex w-full flex-1 items-center justify-center overflow-y-auto px-8 text-center text-2xl font-medium">
                  {back}
                </div>
              </>
            }
          />
        </motion.div>
      </AnimatePresence>

      {(!isFlipped || reserveHint) && (
        <p className={cn('text-center text-sm text-muted-foreground', isFlipped && 'invisible')}>
          {hint}
        </p>
      )}

      {progress}

      {/*
       * Each rating carries its hue in the edge, the fill and the icon; the words
       * stay foreground so the scale reads as one control group instead of four
       * coloured labels. Again and easy take the semantic tokens, which flip with
       * the theme. The two middle steps take the palette, because the token set
       * has a single warning hue and at its chroma amber and orange collapse into
       * the same ochre; one fixed shade cannot hold its edge on both surfaces, so
       * those two step with the theme as well (600 on paper, 400 on the dark
       * card). The fill stays translucent, so the surface shows through it.
       *
       * `ghost` carries `dark:hover:bg-accent/50` on a dark+hover stack that a
       * plain `hover:bg-*` cannot outrank, so the hover tint is declared twice.
       */}
      <div
        className={cn(
          'grid grid-cols-2 gap-2 transition-opacity duration-150',
          isFlipped ? '' : 'pointer-events-none opacity-30',
        )}
      >
        <Button
          variant="ghost"
          disabled={!isFlipped}
          className="border border-destructive/40 bg-destructive/8 text-foreground hover:bg-destructive/12 focus-visible:ring-ring disabled:opacity-100 dark:hover:bg-destructive/12"
          onClick={() => onRate(1)}
          aria-keyshortcuts="1"
        >
          <X className="mr-1.5 size-4 text-destructive" /> {ratingLabels.again}
        </Button>
        <Button
          variant="ghost"
          disabled={!isFlipped}
          className="border border-amber-600/40 bg-amber-600/8 text-foreground hover:bg-amber-600/12 focus-visible:ring-ring disabled:opacity-100 dark:border-amber-400/40 dark:bg-amber-400/8 dark:hover:bg-amber-400/12"
          onClick={() => onRate(3)}
          aria-keyshortcuts="3"
        >
          <Check className="mr-1.5 size-4 text-amber-600 dark:text-amber-400" /> {ratingLabels.good}
        </Button>
        <Button
          variant="ghost"
          disabled={!isFlipped}
          className="border border-orange-600/40 bg-orange-600/8 text-foreground hover:bg-orange-600/12 focus-visible:ring-ring disabled:opacity-100 dark:border-orange-400/40 dark:bg-orange-400/8 dark:hover:bg-orange-400/12"
          onClick={() => onRate(2)}
          aria-keyshortcuts="2"
        >
          <Minus className="mr-1.5 size-4 text-orange-600 dark:text-orange-400" />{' '}
          {ratingLabels.hard}
        </Button>
        <Button
          variant="ghost"
          disabled={!isFlipped}
          className="border border-success/40 bg-success/8 text-foreground hover:bg-success/12 focus-visible:ring-ring disabled:opacity-100 dark:hover:bg-success/12"
          onClick={() => onRate(4)}
          aria-keyshortcuts="4"
        >
          <Zap className="mr-1.5 size-4 text-success" /> {ratingLabels.easy}
        </Button>
      </div>
    </>
  );
}
