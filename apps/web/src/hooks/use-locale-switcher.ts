'use client';

import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useMemo } from 'react';
import { useAnnounceLocale } from '@/components/shared/language-switcher/locale-announcer';
import {
  isSupportedLocale,
  type LanguageOption,
  type Locale,
  languageOption,
  resolveLocale,
  setLocaleCookie,
} from '@/lib/locale';

export type LocaleSwitcher = {
  /** The active locale, request-derived (`useLocale`) so it is hydration-stable. */
  locale: Locale;
  option: LanguageOption;
  /** Commit a locale change. A no-op when the locale is already active. */
  switchTo: (next: Locale) => void;
};

/**
 * The only commit path for a locale change (#634).
 *
 * Order matters: write the cookie, announce in the *pre-switch* language (the
 * translation is resolved before the refresh, so the announcement cannot be
 * re-translated), then refresh the server components in place. `router.refresh()`
 * keeps the URL, the scroll position and window state — unlike the full
 * `location.reload()` one of the two old switchers used.
 */
export function useLocaleSwitcher(): LocaleSwitcher {
  const locale = resolveLocale(useLocale());
  const t = useTranslations('LanguageSwitcher');
  const router = useRouter();
  const announce = useAnnounceLocale();

  const option = useMemo(() => languageOption(locale), [locale]);

  const switchTo = useCallback(
    (next: Locale) => {
      if (next === locale || !isSupportedLocale(next)) return;

      setLocaleCookie(next);
      announce(t('changed', { language: languageOption(next).names[locale] }));
      router.refresh();
    },
    [announce, locale, router, t],
  );

  return { locale, option, switchTo };
}
