import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: 'TermsPage' });
  const title = t('title');

  return { title };
}

export default function TermsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
