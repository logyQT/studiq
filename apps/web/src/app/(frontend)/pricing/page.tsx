'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@studiq/ui';
import { Building2, GraduationCap, User } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { MainLayout } from '@/components/layout/MainLayout';

const TILES = [
  {
    slug: 'student',
    icon: GraduationCap,
    titleKey: 'tile_student_title',
    descKey: 'tile_student_desc',
  },
  {
    slug: 'edu',
    icon: User,
    titleKey: 'tile_edu_title',
    descKey: 'tile_edu_desc',
  },
  {
    slug: 'org',
    icon: Building2,
    titleKey: 'tile_org_title',
    descKey: 'tile_org_desc',
  },
];

export default function PricingPickerPage() {
  const t = useTranslations('PricingPage');

  return (
    <MainLayout>
      <section className="relative overflow-hidden text-center py-12 sm:py-20">
        <div className="absolute inset-0 -z-10 bg-gradient-to-br from-emerald-500/10 via-primary/5 to-blue-500/10 dark:from-emerald-500/5 dark:via-primary/3 dark:to-blue-500/5" />
        <div className="absolute top-1/3 left-1/4 -z-10 h-64 w-64 rounded-full bg-emerald-500/15 blur-3xl" />
        <div className="absolute bottom-1/3 right-1/4 -z-10 h-64 w-64 rounded-full bg-blue-500/15 blur-3xl" />
        <h1 className="text-4xl sm:text-5xl font-bold tracking-tight">{t('title')}</h1>
        <p className="mt-4 text-lg sm:text-xl text-muted-foreground max-w-2xl mx-auto">
          {t('subtitle')}
        </p>
      </section>

      <section className="pb-20">
        <div className="grid sm:grid-cols-3 gap-6 max-w-5xl mx-auto px-4">
          {TILES.map(({ slug, icon: Icon, titleKey, descKey }) => (
            <Card
              key={slug}
              className="group relative flex flex-col items-center text-center p-6 transition-all duration-200 hover:border-primary hover:shadow-lg hover:-translate-y-1 cursor-pointer"
            >
              <Link
                href={`/pricing/${slug}`}
                className="absolute inset-0 z-10"
                aria-label={t(titleKey)}
              />
              <Icon className="size-16 text-primary mb-4" />
              <CardHeader className="p-0 pb-2 w-full">
                <CardTitle className="text-xl">{t(titleKey)}</CardTitle>
              </CardHeader>
              <CardContent className="p-0 w-full">
                <p className="text-sm text-muted-foreground">{t(descKey)}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      </section>
    </MainLayout>
  );
}
