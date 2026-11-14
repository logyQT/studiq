'use client';

import { useIsMobile } from '@studiq/ui';
import { Monitor, Moon, Sun } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useTheme } from 'next-themes';
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import {
  CONTROL_CHROME,
  CONTROL_GLYPH,
  CONTROL_SEGMENT,
  PREFERENCE_GEOMETRY,
  SEGMENT_WIDTH,
} from '@/components/shared/preference-controls';
import { cn } from '@/lib/utils';

const CHOICES = ['light', 'system', 'dark'] as const;
type ThemeChoice = (typeof CHOICES)[number];

const ICONS = { light: Sun, system: Monitor, dark: Moon } as const;

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
  /** `sm` is the compact density for pointer rows; `lg` is the touch density. */
  size?: 'sm' | 'lg';
  className?: string;
};

/**
 * Three-position theme control (#635): Jasny · System · Ciemny.
 *
 * - Thumb position = the stored choice, thumb glyph = the resolved theme, so
 *   "System" stays in the middle and only the glyph follows the OS. The thumb
 *   is the active cell's fill, not a raised indicator, and the cells are split
 *   by 1px hairlines (DESIGN §Shape: pills are status, never buttons). The
 *   outer frame is `border-input` like the language trigger beside it; the
 *   hairlines are interior rules and stay on the decorative `border` token.
 * - The frame is exactly as tall as the language trigger in the same row, from
 *   `PREFERENCE_GEOMETRY`: 44px on touch, 32px compact. Cells fill the frame's
 *   content box, so the active fill reaches the inner edge.
 * - Semantics are a radiogroup (a `switch` is binary by definition); arrows
 *   move the choice, the choice is announced via a polite live region and
 *   shown in a short hint above the track.
 * - The thumb is animated with WAAPI: next-themes injects
 *   `transition: none !important` while the class flips, which would cancel
 *   a CSS transition mid-flight.
 */
export function ThemeSwitch({ size = 'sm', className }: ThemeSwitchProps) {
  const t = useTranslations('ThemeSwitch');
  const { theme, resolvedTheme, setTheme } = useTheme();
  const mounted = useMounted();
  const isMobile = useIsMobile();
  const choice = mounted ? toChoice(theme) : null;
  const resolved = resolvedTheme === 'dark' ? 'dark' : 'light';
  const box = isMobile || size === 'lg' ? PREFERENCE_GEOMETRY.touch : PREFERENCE_GEOMETRY.compact;

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
        { transform: `translateX(${from * SEGMENT_WIDTH}px)` },
        { transform: `translateX(${index * SEGMENT_WIDTH}px)` },
      ],
      // The DESIGN hover/press step and its one curve — the cell fill moves, nothing bounces.
      { duration: 140, easing: 'cubic-bezier(0.2, 0, 0, 1)' },
    );
  }, [index]);

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
    const nextIndex = map[event.key];
    if (nextIndex === undefined) return;
    const next = CHOICES[nextIndex];
    if (!next) return;
    event.preventDefault();
    // Keep the surrounding menu from treating the arrow as item navigation.
    event.stopPropagation();
    select(next, true);
  }

  const ThumbIcon = resolved === 'dark' ? Moon : Sun;

  return (
    <span className={cn('relative inline-flex', className)}>
      <span
        aria-hidden="true"
        className={cn(
          'pointer-events-none absolute bottom-[calc(100%+8px)] left-1/2 z-10 -translate-x-1/2 whitespace-nowrap rounded-control bg-foreground px-2 py-1 text-xs font-medium text-background transition-[opacity,transform]',
          'after:absolute after:left-1/2 after:top-full after:-ml-1 after:border-4 after:border-transparent after:border-t-foreground',
          hint ? 'translate-y-0 opacity-100' : 'translate-y-1 opacity-0',
        )}
      >
        {hint}
      </span>
      <output className="sr-only" aria-live="polite">
        {announcement}
      </output>

      <span
        role="radiogroup"
        aria-label={t('label')}
        className={cn(
          'relative inline-flex overflow-hidden',
          box,
          CONTROL_CHROME,
          // The ring wraps the group: the cells are separated by hairlines, so a
          // per-cell ring would sit on top of its neighbours. Selection and focus
          // coincide (roving tabindex), so the group ring is unambiguous — and
          // `has-[:focus-visible]` keeps it off after a pointer click.
          'has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-ring has-[:focus-visible]:ring-offset-2 has-[:focus-visible]:ring-offset-background',
        )}
      >
        {index !== null && (
          <span
            ref={thumbRef}
            aria-hidden="true"
            style={{ transform: `translateX(${index * SEGMENT_WIDTH}px)` }}
            className={cn(
              CONTROL_SEGMENT,
              'pointer-events-none absolute left-0 top-0 z-0 grid place-items-center bg-secondary text-foreground',
            )}
          >
            <ThumbIcon className={CONTROL_GLYPH} />
            {choice === 'system' && (
              <span className="absolute bottom-0.5 right-0.5 size-1.5 rounded-full bg-primary ring-2 ring-secondary" />
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
              // A custom radio: the button hosts the icon and is measured for the sliding thumb,
              // which a native `<input type="radio">` cannot render.
              // eslint-disable-next-line jsx-a11y/prefer-tag-over-role -- see above.
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
                CONTROL_SEGMENT,
                'relative z-[1] grid place-items-center text-muted-foreground outline-none transition-colors hover:text-foreground',
                // The frame carries the ≥3:1 edge (`CONTROL_CHROME`); the dividers are
                // internal rules and stay on the decorative hairline, so the group reads
                // as one segmented control instead of three separately bordered cells.
                i > 0 && 'border-l border-border',
              )}
            >
              <Icon
                className={cn(
                  CONTROL_GLYPH,
                  'transition-opacity',
                  checked ? 'opacity-0' : 'opacity-100',
                )}
              />
            </button>
          );
        })}
      </span>
    </span>
  );
}
