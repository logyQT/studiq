'use client';

import { motion } from 'motion/react';
import { cn } from '@/lib/utils';

interface FlashcardFlipProps {
  isFlipped: boolean;
  front: React.ReactNode;
  back: React.ReactNode;
  className?: string;
  onClick?: () => void;
}

export function FlashcardFlip({ isFlipped, front, back, className, onClick }: FlashcardFlipProps) {
  return (
    <div className={cn('relative w-full min-h-96 overflow-hidden rounded-xl', className)} style={{ perspective: 1200 }}>
      {/* Front face — always mounted */}
      <motion.div
        className="absolute inset-0 flex flex-col items-center justify-center rounded-xl border bg-card py-6 shadow-sm"
        animate={{
          rotateY: isFlipped ? 90 : 0,
          scale: isFlipped ? 0.92 : 1,
          opacity: isFlipped ? 0 : 1,
        }}
        transition={{ duration: 0.25, ease: [0.4, 0, 1, 1] }}
        onClick={onClick}
      >
        {front}
      </motion.div>

      {/* Back face — always mounted */}
      <motion.div
        className="absolute inset-0 flex flex-col items-center justify-center rounded-xl border bg-card py-6 shadow-sm"
        animate={{
          rotateY: isFlipped ? 0 : -90,
          scale: isFlipped ? 1 : 0.92,
          opacity: isFlipped ? 1 : 0,
        }}
        transition={{
          rotateY: { type: 'spring', stiffness: 300, damping: 25 },
          scale: { type: 'spring', stiffness: 400, damping: 20 },
          opacity: { duration: 0.15 },
        }}
        onClick={onClick}
      >
        {back}
      </motion.div>
    </div>
  );
}
