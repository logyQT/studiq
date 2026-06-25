'use client';

import { motion } from 'motion/react';
import { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface FlashcardFlipProps {
  isFlipped: boolean;
  front: ReactNode;
  back: ReactNode;
  className?: string;
  onClick?: () => void;
}

export function FlashcardFlip({ isFlipped, front, back, className, onClick }: FlashcardFlipProps) {
  return (
    <div
      className={cn('relative w-full h-88 cursor-pointer', className)}
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
