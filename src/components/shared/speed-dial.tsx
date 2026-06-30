'use client';

import type { LucideIcon } from 'lucide-react';
import { Plus } from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useState } from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

interface SpeedDialItem {
  icon: LucideIcon;
  label: string;
  onClick: () => void;
  variant?: 'default' | 'outline' | 'destructive';
}

interface SpeedDialProps {
  items: SpeedDialItem[];
}

const RADIUS = 80;

export function SpeedDial({ items }: SpeedDialProps) {
  const [open, setOpen] = useState(false);

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    },
    [open],
  );

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest('[data-speed-dial]')) {
        setOpen(false);
      }
    };
    window.addEventListener('mousedown', handleClick);
    return () => window.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div data-speed-dial className="fixed bottom-6 right-6 z-50">
      <AnimatePresence>
        {open &&
          items.map((item, i) => {
            const angle = (i / Math.max(items.length - 1, 1)) * (Math.PI / 2);
            const x = -Math.cos(angle) * RADIUS;
            const y = -Math.sin(angle) * RADIUS;

            return (
              <Tooltip key={i}>
                <TooltipTrigger asChild>
                  <motion.button
                    initial={{ scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1, x, y }}
                    exit={{ scale: 0, opacity: 0, x: 0, y: 0 }}
                    transition={{
                      type: 'spring',
                      stiffness: 300,
                      damping: 22,
                      delay: open ? i * 0.05 : (items.length - i) * 0.03,
                    }}
                    onClick={() => {
                      item.onClick();
                      setOpen(false);
                    }}
                    className="absolute bottom-0 right-0 h-11 w-11 rounded-full bg-background border shadow-md flex items-center justify-center text-foreground hover:bg-accent transition-colors"
                  >
                    <item.icon className="h-5 w-5" />
                  </motion.button>
                </TooltipTrigger>
                <TooltipContent side="left" sideOffset={8}>
                  {item.label}
                </TooltipContent>
              </Tooltip>
            );
          })}
      </AnimatePresence>

      <motion.button
        animate={{ rotate: open ? 45 : 0 }}
        transition={{ type: 'spring', stiffness: 300, damping: 20 }}
        onClick={() => setOpen((prev) => !prev)}
        className="relative h-14 w-14 rounded-full bg-primary text-primary-foreground shadow-lg flex items-center justify-center hover:bg-primary/90 transition-colors"
      >
        <Plus className="h-6 w-6" />
      </motion.button>
    </div>
  );
}
