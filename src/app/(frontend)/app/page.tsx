'use client';

import { useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTranslations, useLocale } from 'next-intl';
import { Plus, BookOpen, Layers, Link2, RotateCcw, ArrowRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/components/providers';
import { Button } from '@/components/ui/button';

const actionConfig = [
  { href: '/app/flashcards/decks', icon: Plus, titleKey: 'create_deck', descKey: 'create_deck_desc', color: 'blue' },
  { href: '/app/flashcards/decks', icon: BookOpen, titleKey: 'create_flashcard', descKey: 'create_flashcard_desc', color: 'violet' },
  { href: '/app/flashcards/topics', icon: Layers, titleKey: 'create_topic', descKey: 'create_topic_desc', color: 'amber' },
  { href: '/app/flashcards/topics', icon: Link2, titleKey: 'link_topics', descKey: 'link_topics_desc', color: 'emerald' },
  { href: '/app/study', icon: RotateCcw, titleKey: 'continue_reviewing', descKey: 'continue_reviewing_desc', color: 'rose' },
] as const;

const actionRowVariants: Record<string, string> = {
  blue: 'bg-blue-500/5 hover:bg-blue-500/10 border-blue-500/10 hover:border-blue-500/25',
  violet: 'bg-violet-500/5 hover:bg-violet-500/10 border-violet-500/10 hover:border-violet-500/25',
  amber: 'bg-amber-500/5 hover:bg-amber-500/10 border-amber-500/10 hover:border-amber-500/25',
  emerald: 'bg-emerald-500/5 hover:bg-emerald-500/10 border-emerald-500/10 hover:border-emerald-500/25',
  rose: 'bg-rose-500/5 hover:bg-rose-500/10 border-rose-500/10 hover:border-rose-500/25',
};

const actionIconVariants: Record<string, string> = {
  blue: 'bg-blue-500/15 text-blue-600 dark:text-blue-400',
  violet: 'bg-violet-500/15 text-violet-600 dark:text-violet-400',
  amber: 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
  emerald: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
  rose: 'bg-rose-500/15 text-rose-600 dark:text-rose-400',
};

export default function AppOverviewPage() {
  const t = useTranslations('AppOverviewPage');
  const locale = useLocale();
  const router = useRouter();

  const todayStr = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
      }).format(new Date()),
    [locale],
  );

  const { user } = useAuth();
  const userName = user?.user_metadata?.name || user?.email?.split('@')[0] || 'Alex';

  const handleContinueReviewing = useCallback(() => router.push('/app/study'), [router]);
  const handleCreateDeck = useCallback(() => router.push('/app/flashcards/decks'), [router]);

  return (
    <>
      <div className="bg-muted/30 pt-8 pb-6">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 md:px-8">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            {todayStr}
          </p>
          <h1 className="text-5xl font-semibold mb-6 tracking-tight text-foreground">
            {t('hello_greeting', { name: userName })}
          </h1>

          <div className="flex flex-wrap items-center gap-4">
            <Button variant="default" size="sm" onClick={handleContinueReviewing}>
              <RotateCcw className="w-4 h-4 mr-1.5" />
              {t('continue_reviewing')}
            </Button>
            <Button variant="outline" size="sm" onClick={handleCreateDeck}>
              <Plus className="w-4 h-4 mr-1.5" />
              {t('create_deck')}
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 md:px-8 py-12">
        <section>
          <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-4">
            {t('quick_actions')}
          </h3>
          <div className="space-y-2">
            {actionConfig.map(({ href, icon: Icon, titleKey, descKey, color }) => (
              <Link key={titleKey} href={href} className="group block">
                <div
                  className={cn(
                    'flex items-center gap-4 p-4 rounded-xl border transition-all duration-200 cursor-pointer',
                    actionRowVariants[color],
                  )}
                >
                  <div
                    className={cn(
                      'rounded-xl p-3 shrink-0 group-hover:scale-110 transition-transform duration-200',
                      actionIconVariants[color],
                    )}
                  >
                    <Icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-sm text-foreground">{t(titleKey)}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">{t(descKey)}</p>
                  </div>
                  <ArrowRight className="h-4 w-4 text-muted-foreground group-hover:translate-x-1 transition-all duration-200 shrink-0" />
                </div>
              </Link>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
