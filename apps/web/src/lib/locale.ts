/**
 * Single source of truth for the UI locale (#634).
 *
 * This is the only module allowed to know the `NEXT_LOCALE` cookie name, its
 * lifetime or the supported locale list — `i18n/request.ts` reads the value
 * server-side, and every UI surface writes it through `setLocaleCookie()`.
 * No React and no DOM access at module scope, so it is safe to import from the
 * server, the browser and Node unit tests.
 */

export const LOCALES = ['pl', 'en'] as const;
export type Locale = (typeof LOCALES)[number];

export const DEFAULT_LOCALE: Locale = 'pl';
export const LOCALE_COOKIE = 'NEXT_LOCALE';
export const LOCALE_MAX_AGE_SECONDS = 31_536_000;

export type LanguageOption = {
  code: Locale;
  /** The language's own name — never translated. */
  endonym: string;
  /** How this language is called in each locale, e.g. `{ pl: 'angielski', en: 'English' }`. */
  names: Record<Locale, string>;
  /** Extra search terms (code, English name, …) for the panel's fuzzy filter. */
  aliases: readonly string[];
};

/**
 * Keyed by `Locale`, so adding a locale fails to typecheck until it has a name,
 * its localized names in every locale, and its aliases.
 */
const OPTIONS: Record<Locale, LanguageOption> = {
  pl: {
    code: 'pl',
    endonym: 'Polski',
    names: { pl: 'polski', en: 'Polish' },
    aliases: ['polski', 'polish', 'pl'],
  },
  en: {
    code: 'en',
    endonym: 'English',
    names: { pl: 'angielski', en: 'English' },
    aliases: ['english', 'angielski', 'en'],
  },
};

/** Every supported locale, in display order. */
export const LANGUAGE_OPTIONS: readonly LanguageOption[] = LOCALES.map((code) => OPTIONS[code]);

export function isSupportedLocale(code: string): code is Locale {
  return (LOCALES as readonly string[]).includes(code);
}

export function languageOption(code: Locale): LanguageOption {
  return OPTIONS[code];
}

/** `'EN'` / `' en '` → `'en'`; anything unsupported or absent → the default locale. */
export function resolveLocale(value: unknown): Locale {
  if (typeof value !== 'string') return DEFAULT_LOCALE;
  const normalized = value.trim().toLowerCase();
  return (LOCALES as readonly string[]).includes(normalized)
    ? (normalized as Locale)
    : DEFAULT_LOCALE;
}

/** The exact cookie payload — pure, so the contract can be unit-tested. */
export function localeCookie(locale: Locale): string {
  return `${LOCALE_COOKIE}=${locale}; path=/; max-age=${LOCALE_MAX_AGE_SECONDS}; samesite=lax`;
}

/** Write the locale cookie. A no-op outside the browser (SSR, unit tests). */
export function setLocaleCookie(locale: Locale): void {
  if (typeof document === 'undefined') return;
  document.cookie = localeCookie(locale);
}
