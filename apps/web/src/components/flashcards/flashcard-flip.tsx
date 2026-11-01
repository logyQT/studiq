'use client';

import { motion } from 'motion/react';
import type { KeyboardEvent, ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface FlashcardFlipProps {
  isFlipped: boolean;
  front: ReactNode;
  back: ReactNode;
  className?: string;
  onClick?: () => void;
  /**
   * Accessible name for the focusable card. The wrapper is a `group`, not a button: the faces
   * render markdown, and the button role would turn any link inside them presentational.
   */
  ariaLabel?: string;
}

export function FlashcardFlip({
  isFlipped,
  front,
  back,
  className,
  onClick,
  ariaLabel,
}: FlashcardFlipProps) {
  // Keyboard parity with `onClick`, for the card itself only: a focused link inside a face keeps
  // Enter for its own activation. The event is consumed so the page-level Space handlers (the
  // study session flips on Space) cannot flip the card a second time.
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return;
    if (e.key !== 'Enter' && e.key !== ' ' && e.code !== 'Space') return;
    e.preventDefault();
    e.stopPropagation();
    onClick?.();
  }

  return (
    <div
      role="group"
      aria-label={ariaLabel}
      aria-keyshortcuts="Enter Space"
      tabIndex={0}
      onKeyDown={onKeyDown}
      className={cn(
        'relative w-full h-88 cursor-pointer rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
        className,
      )}
      style={{ perspective: 1200 }}
      onClick={onClick}
    >
      <motion.div
        className="relative w-full h-full"
        animate={{ rotateY: isFlipped ? 180 : 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 28 }}
        style={{ transformStyle: 'preserve-3d' }}
      >
        {/* Front face */}
        <div
          className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl border bg-card shadow-md overflow-hidden"
          style={{ backfaceVisibility: 'hidden', WebkitBackfaceVisibility: 'hidden' }}
        >
          {front}
        </div>

        {/* Back face — pre-rotated 180° so it appears correctly when flipped */}
        <div
          className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl border bg-card shadow-md overflow-hidden"
          style={{
            backfaceVisibility: 'hidden',
            WebkitBackfaceVisibility: 'hidden',
            transform: 'rotateY(180deg)',
          }}
        >
          {back}
        </div>
      </motion.div>
    </div>
  );
}
