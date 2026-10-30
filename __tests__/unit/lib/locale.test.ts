import { afterEach, describe, expect, it } from 'vitest';
import {
  DEFAULT_LOCALE,
  LANGUAGE_OPTIONS,
  LOCALE_COOKIE,
  LOCALE_MAX_AGE_SECONDS,
  LOCALES,
  localeCookie,
  resolveLocale,
  setLocaleCookie,
} from '@/lib/locale';

/**
 * #634 — `lib/locale.ts` is the single owner of the locale list and the
 * `NEXT_LOCALE` cookie (the old code had three copies and two writers). These
 * tests pin the contract the app now depends on everywhere.
 */

const DOCUMENT_DESCRIPTOR = Object.getOwnPropertyDescriptor(globalThis, 'document');

function stubDocument() {
  const doc = { cookie: '' };
  Object.defineProperty(globalThis, 'document', { value: doc, configurable: true });
  return doc;
}

afterEach(() => {
  if (DOCUMENT_DESCRIPTOR) {
    Object.defineProperty(globalThis, 'document', DOCUMENT_DESCRIPTOR);
  } else {
    delete (globalThis as { document?: unknown }).document;
  }
});

describe('resolveLocale', () => {
  it('passes supported locales through', () => {
    expect(resolveLocale('pl')).toBe('pl');
    expect(resolveLocale('en')).toBe('en');
  });

  it('normalises case and surrounding whitespace', () => {
    expect(resolveLocale('EN')).toBe('en');
    expect(resolveLocale(' en ')).toBe('en');
    expect(resolveLocale(' Pl ')).toBe('pl');
  });

  it('falls back to the default locale for anything unsupported', () => {
    for (const value of ['fr', '', '  ', null, undefined, 42, {}, ['en']]) {
      expect(resolveLocale(value), String(value)).toBe(DEFAULT_LOCALE);
    }
  });
});

describe('locale cookie', () => {
  it('exposes the shared names and lifetime', () => {
    expect(LOCALE_COOKIE).toBe('NEXT_LOCALE');
    expect(LOCALE_MAX_AGE_SECONDS).toBe(31_536_000);
  });

  it('builds the exact cookie payload', () => {
    expect(localeCookie('en')).toBe('NEXT_LOCALE=en; path=/; max-age=31536000; samesite=lax');
    expect(localeCookie('pl')).toBe('NEXT_LOCALE=pl; path=/; max-age=31536000; samesite=lax');
  });

  it('writes the payload to document.cookie', () => {
    const doc = stubDocument();

    setLocaleCookie('en');

    expect(doc.cookie).toBe('NEXT_LOCALE=en; path=/; max-age=31536000; samesite=lax');
  });

  it('is a no-op without a document (SSR)', () => {
    delete (globalThis as { document?: unknown }).document;

    expect(() => setLocaleCookie('en')).not.toThrow();
  });
});

describe('language metadata', () => {
  it('keeps LOCALES and LANGUAGE_OPTIONS in bijection', () => {
    expect(LANGUAGE_OPTIONS.map((option) => option.code)).toEqual([...LOCALES]);
  });

  it('includes the default locale', () => {
    expect(LOCALES).toContain(DEFAULT_LOCALE);
  });

  it('keeps exactly one option per endonym', () => {
    // cmdk's item `value` is the endonym and the panel's `aria-activedescendant`
    // sync subscribes to cmdk's highlighted value — duplicate endonyms would
    // make both ambiguous.
    expect(new Set(LANGUAGE_OPTIONS.map((option) => option.endonym)).size).toBe(LOCALES.length);
  });

  it('describes every language in every locale and stays searchable', () => {
    for (const option of LANGUAGE_OPTIONS) {
      expect(option.endonym.trim(), option.code).not.toHaveLength(0);

      for (const locale of LOCALES) {
        expect(option.names[locale]?.trim(), `${option.code}.names.${locale}`).toBeTruthy();
      }
      expect(option.aliases, `${option.code} aliases`).toContain(option.code);

      // The English name and the language's own name must both be searchable,
      // otherwise typing "english" in the Polish UI would not find English.
      expect(option.aliases).toContain(option.endonym.toLowerCase());
      expect(option.aliases).toContain(option.names.en.toLowerCase());
    }
  });
});
