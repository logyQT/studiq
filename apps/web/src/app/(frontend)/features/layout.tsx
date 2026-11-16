import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';

/*
 * Metadata lives in the segment layout, not the page: the page is a client
 * component (it renders the interactive previews), and a client module cannot
 * export `generateMetadata`.
 */
export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: 'FeaturesPage' });
  const title = t('meta_title');
  const description = t('meta_description');

  return {
    title,
    description,
    alternates: { canonical: '/features' },
    openGraph: { title, description, type: 'website' },
    twitter: { card: 'summary_large_image', title, description },
  };
}

export default function FeaturesLayout({ children }: { children: React.ReactNode }) {
  return children;
}
