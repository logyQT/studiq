import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: 'PrivacyPage' });
  const title = t('title');

  return { title };
}

export default function PrivacyLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
