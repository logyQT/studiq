'use client';

import { ChevronDown, ChevronUp } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';

interface ScrollBackToBarProps {
  chevronDirection: 'up' | 'down';
  barPosition: 'top' | 'bottom';
  visible: boolean;
  onClick?: () => void;
  className?: string;
  style?: React.CSSProperties;
}

export function ScrollBackToBar({
  chevronDirection,
  barPosition,
  visible,
  onClick,
  className = '',
  style,
}: ScrollBackToBarProps) {
  const Icon = chevronDirection === 'down' ? ChevronDown : ChevronUp;
  const isBottomBar = barPosition === 'bottom';

  const barClasses = isBottomBar
    ? 'h-24 bg-linear-to-t from-background/95 via-background/50 to-transparent mask-[linear-gradient(to_top,black_35%,transparent_100%)] [-webkit-mask-image:linear-gradient(to_top,black_35%,transparent_100%)] items-end justify-center pb-3'
    : 'h-24 bg-linear-to-b from-background/95 via-background/50 to-transparent mask-[linear-gradient(to_bottom,black_35%,transparent_100%)] [-webkit-mask-image:linear-gradient(to_bottom,black_35%,transparent_100%)] items-start justify-center pt-3';

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: isBottomBar ? 10 : -10 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: isBottomBar ? 10 : -10 }}
          transition={{ duration: 0.2 }}
          className={`flex backdrop-blur-sm overflow-hidden pointer-events-none ${barClasses} ${className}`}
          style={style}
        >
          <div className="mx-auto flex w-full max-w-3xl items-center justify-center">
            <motion.button
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.15 }}
              onClick={onClick}
              className="text-foreground/70 hover:text-foreground transition-colors pointer-events-auto"
            >
              <Icon className="h-10 w-10" />
            </motion.button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
