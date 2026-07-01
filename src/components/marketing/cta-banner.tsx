'use client';

import { ArrowRight } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';

export function CtaBanner() {
  const t = useTranslations('LandingPage');

  return (
    <section className="py-16 sm:py-24">
      <div className="mx-auto max-w-3xl">
        <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary/10 via-primary/5 to-primary/10 border p-10 sm:p-14 text-center">
          <div className="absolute top-0 right-0 -z-10 size-64 rounded-full bg-primary/10 blur-3xl" />
          <div className="absolute bottom-0 left-0 -z-10 size-48 rounded-full bg-primary/5 blur-3xl" />
          <h2 className="text-3xl sm:text-4xl font-bold tracking-tight">{t('cta_banner_title')}</h2>
          <p className="mt-4 text-lg text-muted-foreground max-w-lg mx-auto">
            {t('cta_banner_desc')}
          </p>
          <div className="mt-8">
            <Button size="lg" className="text-base px-8" asChild>
              <Link href="/register">
                {t('cta_banner_button')} <ArrowRight className="ml-2 size-4" />
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
