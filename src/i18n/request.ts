import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';

export const locales = ['pl', 'en'];
const defaultLocale = 'pl';

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
  const locale = cookieStore.get('NEXT_LOCALE')?.value || defaultLocale;

  const activeLocale = locales.includes(locale) ? locale : defaultLocale;

  return {
    locale: activeLocale,
    messages: mergeCommon((await import(`./messages/${activeLocale}.json`)).default),
  };
});
