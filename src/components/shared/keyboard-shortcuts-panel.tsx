'use client';

import { useState, useEffect, useCallback } from 'react';
import { Keyboard } from 'lucide-react';
import { HoverCard, HoverCardTrigger, HoverCardContent } from '@/components/ui/hover-card';

interface Shortcut {
  key: string;
  label: string;
}

interface KeyboardShortcutsPanelProps {
  shortcuts: Shortcut[];
  trigger?: 'icon' | 'keycaps';
}

function Keycap({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="bg-zinc-700 dark:bg-zinc-800 border border-zinc-600 dark:border-zinc-500 rounded-md px-2.5 py-1 text-sm font-medium text-zinc-200 dark:text-zinc-100 shadow-[0_2px_0_0_rgba(0,0,0,0.2)] min-w-[2rem] justify-center inline-flex items-center select-none">
      {children}
    </kbd>
  );
}

function KeycapSmall({ children }: { children: React.ReactNode }) {
  return (
    <kbd className="bg-zinc-700 dark:bg-zinc-800 border border-zinc-600 dark:border-zinc-500 rounded-md px-2 py-0.5 text-xs font-medium text-zinc-200 dark:text-zinc-100 shadow-[0_2px_0_0_rgba(0,0,0,0.2)] inline-flex items-center select-none">
      {children}
    </kbd>
  );
}

export function KeyboardShortcutsPanel({ shortcuts, trigger = 'icon' }: KeyboardShortcutsPanelProps) {
  const [open, setOpen] = useState(false);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const tag = (document.activeElement as HTMLElement)?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || (document.activeElement as HTMLElement)?.isContentEditable) return;

    if (e.altKey && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      setOpen((prev) => !prev);
    }
    if (e.key === 'Escape' && open) {
      setOpen(false);
    }
  }, [open]);

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  return (
    <div className="sticky bottom-6 flex justify-center">
      <HoverCard open={open} onOpenChange={setOpen} openDelay={0} closeDelay={0}>
        <HoverCardTrigger asChild>
          {trigger === 'icon' ? (
            <button
              className="h-12 w-12 flex items-center justify-center text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Keyboard shortcuts"
            >
              <Keyboard className="h-8 w-8" />
            </button>
          ) : (
            <button
              className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Keyboard shortcuts"
            >
              <KeycapSmall>Alt</KeycapSmall>
              <KeycapSmall>K</KeycapSmall>
            </button>
          )}
        </HoverCardTrigger>
        <HoverCardContent
          side="top"
          align="center"
          sideOffset={8}
          className="w-auto p-4 bg-background border shadow-md rounded-lg"
        >
          <div className="flex items-start gap-5">
            {shortcuts.map((s) => (
              <div key={s.key} className="flex flex-col items-center gap-1.5">
                <span className="text-base text-muted-foreground">{s.label}</span>
                <Keycap>{s.key}</Keycap>
              </div>
            ))}
          </div>
        </HoverCardContent>
      </HoverCard>
    </div>
  );
}
