import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALES, resolveLocale } from '@/lib/locale';

/** Derived from the single locale source (`lib/locale.ts`) — never re-declared. */
export const locales = LOCALES;

function mergeCommon(raw: Record<string, Record<string, string>>) {
  const common = raw.Common ?? {};
  const merged: Record<string, Record<string, string>> = {};
  for (const [ns, keys] of Object.entries(raw)) {
    merged[ns] = ns === 'Common' ? keys : { ...common, ...keys };
  }
  return merged;
}

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const activeLocale = resolveLocale(cookieStore.get(LOCALE_COOKIE)?.value ?? DEFAULT_LOCALE);

  return {
    locale: activeLocale,
    messages: mergeCommon((await import(`./messages/${activeLocale}.json`)).default),
  };
});
