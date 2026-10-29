'use client';

import type { ComponentType } from 'react';
import { useId } from 'react';
import type { Locale } from '@/lib/locale';
import { cn } from '@/lib/utils';

/**
 * Decorative locale flags (#634).
 *
 * Hand-authored inline SVGs: a national flag's geometry is not a licensed
 * asset, so there is no dependency, no network request and no third-party
 * notice. Flags are **never** the accessible name of a control — they are
 * `aria-hidden` and always sit next to the language's endonym.
 */

function PolandFlag() {
  return (
    <svg
      viewBox="0 0 20 15"
      aria-hidden="true"
      focusable="false"
      preserveAspectRatio="xMidYMid slice"
      className="size-full"
    >
      <rect width="20" height="7.5" fill="#ffffff" />
      <rect y="7.5" width="20" height="7.5" fill="#DC143C" />
    </svg>
  );
}

function UnitedKingdomFlag() {
  const clipId = `gb-flag-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;

  return (
    <svg
      viewBox="0 0 60 30"
      aria-hidden="true"
      focusable="false"
      preserveAspectRatio="xMidYMid slice"
      className="size-full"
    >
      <clipPath id={clipId}>
        <path d="M30,15 h30 v15 z v15 h-30 z h-30 v-15 z v-15 h30 z" />
      </clipPath>
      <path d="M0,0 v30 h60 v-30 z" fill="#012169" />
      <path d="M0,0 L60,30 M60,0 L0,30" stroke="#ffffff" strokeWidth="6" />
      <path
        d="M0,0 L60,30 M60,0 L0,30"
        clipPath={`url(#${clipId})`}
        stroke="#C8102E"
        strokeWidth="4"
      />
      <path d="M30,0 v30 M0,15 h60" stroke="#ffffff" strokeWidth="10" />
      <path d="M30,0 v30 M0,15 h60" stroke="#C8102E" strokeWidth="6" />
    </svg>
  );
}

/** `Record<Locale, …>` — adding a locale fails to typecheck until it has a flag. */
const FLAG_BY_LOCALE: Record<Locale, ComponentType> = {
  pl: PolandFlag,
  en: UnitedKingdomFlag,
};

/**
 * 4:3 box, artwork cropped to fill (no letterboxing). The hairline is an
 * overlay *above* the artwork, so the PL flag's white field stays visible on
 * light and dark surfaces.
 */
const FLAG_WRAPPER_CLASS =
  "relative inline-flex h-3.5 w-[1.1875rem] shrink-0 overflow-hidden rounded-[3px] after:pointer-events-none after:absolute after:inset-0 after:rounded-[inherit] after:shadow-[inset_0_0_0_1px_rgb(0_0_0/0.14)] after:content-[''] dark:after:shadow-[inset_0_0_0_1px_rgb(255_255_255/0.2)]";

export function LocaleFlag({ locale, className }: { locale: Locale; className?: string }) {
  const Flag = FLAG_BY_LOCALE[locale];

  return (
    <span aria-hidden="true" data-slot="locale-flag" className={cn(FLAG_WRAPPER_CLASS, className)}>
      <Flag />
    </span>
  );
}
