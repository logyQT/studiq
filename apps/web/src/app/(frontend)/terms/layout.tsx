import type { Metadata } from 'next';
import { getLocale, getTranslations } from 'next-intl/server';
import { MainLayout } from '@/components/layout/MainLayout';

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const t = await getTranslations({ locale, namespace: 'TermsPage' });
  const title = t('title');

  return { title };
}

export default function TermsLayout({ children }: { children: React.ReactNode }) {
  return <MainLayout>{children}</MainLayout>;
}
