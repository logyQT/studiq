'use client';

import { LocaleFlag } from '@/components/shared/language-switcher/locale-flag';
import type { LanguageOption, Locale } from '@/lib/locale';
import { cn } from '@/lib/utils';

export type LanguageOptionLabelProps = {
  option: LanguageOption;
  /** The UI locale — used for the secondary, localized name ("English · angielski"). */
  uiLocale: Locale;
  /** Show the localized name next to the endonym (lists), or just the endonym (triggers). */
  withLocalizedName?: boolean;
  className?: string;
};

/**
 * One language, rendered the same way on every surface (#634): a decorative
 * flag, the endonym in its own language (never machine-translated), and — in
 * lists — the language's name in the UI language, muted, so a user can find a
 * language without knowing its endonym.
 */
export function LanguageOptionLabel({
  option,
  uiLocale,
  withLocalizedName = false,
  className,
}: LanguageOptionLabelProps) {
  const localized = option.names[uiLocale];
  const showLocalized =
    withLocalizedName && localized && localized.toLowerCase() !== option.endonym.toLowerCase();

  return (
    <span className={cn('flex min-w-0 items-center gap-2.5', className)}>
      <LocaleFlag locale={option.code} />
      <span className="flex min-w-0 items-baseline gap-2">
        <span translate="no" lang={option.code} className="truncate">
          {option.endonym}
        </span>
        {showLocalized && (
          <span className="truncate text-xs text-muted-foreground">{localized}</span>
        )}
      </span>
    </span>
  );
}
