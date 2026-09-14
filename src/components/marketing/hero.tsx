'use client';

import { ArrowRight, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

export function Hero() {
  const t = useTranslations('LandingPage');

  return (
    <section className="relative overflow-hidden py-24 sm:py-36">
      <div className="absolute inset-0 -z-10 bg-gradient-to-br from-violet-500/10 via-primary/5 to-cyan-500/10 dark:from-violet-500/5 dark:via-primary/3 dark:to-cyan-500/5" />
      <div className="absolute top-1/3 left-1/4 -z-10 size-80 rounded-full bg-violet-500/20 blur-3xl animate-pulse" />
      <div className="absolute bottom-1/4 right-1/4 -z-10 size-96 rounded-full bg-cyan-500/15 blur-3xl animate-pulse [animation-delay:1s]" />
      <div className="mx-auto max-w-5xl text-center">
        <Badge variant="secondary" className="mb-6 px-4 py-1.5 text-sm gap-1.5">
          <Sparkles className="size-3.5" />
          {t('hero_badge')}
        </Badge>
        <h1 className="text-4xl sm:text-6xl lg:text-7xl font-bold tracking-tight leading-tight">
          {t('hero_title')}
        </h1>
        <p className="mt-6 text-lg sm:text-xl text-muted-foreground max-w-3xl mx-auto leading-relaxed">
          {t('hero_subtitle')}
        </p>
        <div className="mt-10 flex flex-col sm:flex-row items-center justify-center gap-4">
          <Button size="lg" className="text-base px-8" asChild>
            <Link href="/register">{t('cta_start')}</Link>
          </Button>
          <Button size="lg" variant="outline" className="text-base px-8" asChild>
            <Link href="/features">
              {t('cta_features')} <ArrowRight className="ml-2 size-4" />
            </Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
