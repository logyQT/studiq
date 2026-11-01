'use client';

import { Monitor, Moon, Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { cn } from '@/lib/utils';

const CHOICES = ['light', 'system', 'dark'] as const;
type ThemeChoice = (typeof CHOICES)[number];

const ICONS = { light: Sun, system: Monitor, dark: Moon } as const;

const SIZES = {
  sm: { cell: 'size-7', icon: 'size-3.5', step: 28 },
  md: { cell: 'size-8', icon: 'size-4', step: 32 },
  // Touch surfaces (mobile drawer / sheet): 44px targets.
  lg: { cell: 'size-11', icon: 'size-5', step: 44 },
} as const;

const HINT_MS = 1600;

const subscribeNoop = () => () => {};

/** `true` only on the client — `theme`/`resolvedTheme` are unknown during SSR. */
function useMounted() {
  return useSyncExternalStore(
    subscribeNoop,
    () => true,
    () => false,
  );
}

function toChoice(theme: string | undefined): ThemeChoice {
  return theme === 'light' || theme === 'dark' ? theme : 'system';
}

export type ThemeSwitchProps = {
  size?: keyof typeof SIZES;
  className?: string;
};

/**
 * Three-position theme control (#635): Jasny · System · Ciemny.
 *
 * - Thumb position = the stored choice, thumb glyph = the resolved theme, so
 *   "System" stays in the middle and only the glyph follows the OS.
 * - Semantics are a radiogroup (a `switch` is binary by definition); arrows
 *   move the choice, the choice is announced via a polite live region and
 *   shown in a short hint above the track.
 * - The thumb is animated with WAAPI: next-themes injects
 *   `transition: none !important` while the class flips, which would cancel
 *   a CSS transition mid-flight.
 */
export function ThemeSwitch({ size = 'md', className }: ThemeSwitchProps) {
  const t = useTranslations('ThemeSwitch');
  const { theme, resolvedTheme, setTheme } = useTheme();
  const mounted = useMounted();
  const choice = mounted ? toChoice(theme) : null;
  const resolved = resolvedTheme === 'dark' ? 'dark' : 'light';
  const { cell, icon, step } = SIZES[size];

  const thumbRef = useRef<HTMLSpanElement>(null);
  const cellRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const prevIndex = useRef<number | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState('');
  const hintTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const userChanged = useRef(false);
  // Bumped on every activation, so re-choosing the current position still shows the hint.
  const [activation, setActivation] = useState(0);

  const index = choice ? CHOICES.indexOf(choice) : null;

  useLayoutEffect(() => {
    if (index === null || !thumbRef.current) return;
    const from = prevIndex.current;
    prevIndex.current = index;
    if (from === null || from === index) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    thumbRef.current.animate(
      [
        { transform: `translateX(${from * step}px)` },
        { transform: `translateX(${index * step}px)` },
      ],
      { duration: 320, easing: 'cubic-bezier(.3,1.3,.5,1)' },
    );
  }, [index, step]);

  // `resolvedTheme` is unknown on the server — keep labels neutral until mounted (hydration-safe).
  const label = (c: ThemeChoice) =>
    c === 'system' && mounted ? t('system_resolved', { theme: t(`resolved_${resolved}`) }) : t(c);

  // The hint is written after the theme has resolved, so "System" names the real result.
  useEffect(() => {
    if (activation === 0 || !userChanged.current || !choice) return;
    userChanged.current = false;
    const text =
      choice === 'system' ? t('system_resolved', { theme: t(`resolved_${resolved}`) }) : t(choice);
    setHint(text);
    setAnnouncement(text);
    clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(null), HINT_MS);
  }, [choice, resolved, t, activation]);

  useEffect(() => () => clearTimeout(hintTimer.current), []);

  function select(next: ThemeChoice, focus = false) {
    userChanged.current = true;
    setActivation((n) => n + 1);
    setTheme(next);
    if (focus) cellRefs.current[CHOICES.indexOf(next)]?.focus();
  }

  function onKeyDown(event: React.KeyboardEvent, i: number) {
    const map: Record<string, number> = {
      ArrowRight: Math.min(i + 1, 2),
      ArrowDown: Math.min(i + 1, 2),
      ArrowLeft: Math.max(i - 1, 0),
      ArrowUp: Math.max(i - 1, 0),
      Home: 0,
      End: 2,
    };
    if (!(event.key in map)) return;
    event.preventDefault();
    // Keep the surrounding menu from treating the arrow as item navigation.
    event.stopPropagation();
    select(CHOICES[map[event.key]], true);
  }

  const ThumbIcon = resolved === 'dark' ? Moon : Sun;

  return (
    <span className={cn('relative inline-flex', className)}>
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background shadow-sm transition-all duration-150',
          'after:absolute after:left-1/2 after:top-full after:-ml-1 after:border-4 after:border-transparent after:border-t-foreground',
          hint ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0',
        )}
      >
        {hint}
      </span>
      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>

      <span
        role="radiogroup"
        aria-label={t('label')}
        className="relative inline-flex rounded-full border bg-muted p-0.5"
      >
        {index !== null && (
          <span
            ref={thumbRef}
            aria-hidden="true"
            style={{ transform: `translateX(${index * step}px)` }}
            className={cn(
              cell,
              'pointer-events-none absolute left-0.5 top-0.5 z-0 grid place-items-center rounded-full bg-background text-foreground shadow-sm ring-1 ring-border',
            )}
          >
            <ThumbIcon className={icon} />
            {choice === 'system' && (
              <span className="absolute bottom-0.5 right-0.5 size-1.5 rounded-full bg-primary ring-2 ring-background" />
            )}
          </span>
        )}
        {CHOICES.map((c, i) => {
          const Icon = ICONS[c];
          const checked = choice === c;
          return (
            <button
              key={c}
              ref={(el) => {
                cellRefs.current[i] = el;
              }}
              type="button"
              role="radio"
              aria-checked={checked}
              aria-label={label(c)}
              title={t(c)}
              tabIndex={checked || (choice === null && i === 1) ? 0 : -1}
              disabled={!mounted}
              onClick={(event) => {
                event.stopPropagation();
                select(c);
              }}
              onKeyDown={(event) => onKeyDown(event, i)}
              className={cn(
                cell,
                'relative z-[1] grid place-items-center rounded-full text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
              )}
            >
              <Icon
                className={cn(icon, 'transition-opacity', checked ? 'opacity-0' : 'opacity-60')}
              />
            </button>
          );
        })}
      </span>
    </span>
  );
}
