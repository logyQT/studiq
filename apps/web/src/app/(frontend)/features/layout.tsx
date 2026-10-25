import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: 'FeaturesPage' });
  const title = t('meta_title');
  const description = t('subtitle');

  return { title, description };
}

export default function FeaturesLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
