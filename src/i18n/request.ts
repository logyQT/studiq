import { getRequestConfig } from 'next-intl/server';
import { cookies } from 'next/headers';

export const locales = ['pl', 'en'];
const defaultLocale = 'pl';

export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const locale = cookieStore.get('NEXT_LOCALE')?.value || defaultLocale;

  const activeLocale = locales.includes(locale) ? locale : defaultLocale;

  return {
    locale: activeLocale,
    messages: (await import(`./messages/${activeLocale}.json`)).default,
  };
});
