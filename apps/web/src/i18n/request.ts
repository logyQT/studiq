import { cookies } from 'next/headers';
import { getRequestConfig } from 'next-intl/server';
import { DEFAULT_LOCALE, LOCALE_COOKIE, LOCALES, type Locale, resolveLocale } from '@/lib/locale';
import { isRecord } from '@/lib/unknown-value';

/** Derived from the single locale source (`lib/locale.ts`) — never re-declared. */
export const locales = LOCALES;

type Messages = Record<string, Record<string, string>>;

function mergeCommon(raw: Messages) {
  const common = raw.Common ?? {};
  const merged: Messages = {};
  for (const [ns, keys] of Object.entries(raw)) {
    merged[ns] = ns === 'Common' ? keys : { ...common, ...keys };
  }
  return merged;
}

/** `{ key: message }` — the shape of one namespace in a `messages/<locale>.json`. */
function isNamespace(value: unknown): value is Record<string, string> {
  if (!isRecord(value)) return false;
  for (const message of Object.values(value)) {
    if (typeof message !== 'string') return false;
  }
  return true;
}

/** `{ namespace: { key: message } }` — the shape of a messages file. */
function isMessages(value: unknown): value is Messages {
  if (!isRecord(value)) return false;
  for (const namespace of Object.values(value)) {
    if (!isNamespace(namespace)) return false;
  }
  return true;
}

/**
 * The messages of the active locale. The locale is one of `LOCALES`, so the file
 * always exists; a payload that is not a messages tree degrades to no messages
 * instead of putting a mistyped object in `next-intl`.
 */
async function loadMessages(locale: Locale): Promise<Messages> {
  const module: unknown = await import(`./messages/${locale}.json`);
  const messages = isRecord(module) ? module.default : undefined;
  return isMessages(messages) ? messages : {};
}

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const activeLocale = resolveLocale(cookieStore.get(LOCALE_COOKIE)?.value ?? DEFAULT_LOCALE);

  return {
    locale: activeLocale,
    messages: mergeCommon(await loadMessages(activeLocale)),
  };
});
