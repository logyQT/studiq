'use client';

import { useMemo, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTranslations, useLocale } from 'next-intl';
import { Plus, BookOpen, Layers, Link2, RotateCcw, ArrowRight, BarChart3, Settings, Target } from 'lucide-react';
import { Area, AreaChart, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts';
import { cn } from '@/lib/utils';
import { useAuth } from '@/components/providers';
import { useApiQuery } from '@/hooks/use-api';
import { Button } from '@/components/ui/button';
import { StatCard } from '@/components/ui/stat-card';

const chartData = [
  { name: 'Mon', value: 12 },
  { name: 'Tue', value: 28 },
  { name: 'Wed', value: 18 },
  { name: 'Thu', value: 36 },
  { name: 'Fri', value: 22 },
  { name: 'Sat', value: 43 },
  { name: 'Sun', value: 31 },
];

const actionConfig = [
  { href: '/app/flashcards/decks', icon: Plus, titleKey: 'create_deck', descKey: 'create_deck_desc', color: 'blue' },
  { href: '/app/flashcards/decks', icon: BookOpen, titleKey: 'create_flashcard', descKey: 'create_flashcard_desc', color: 'violet' },
  { href: '/app/flashcards/topics', icon: Layers, titleKey: 'create_topic', descKey: 'create_topic_desc', color: 'amber' },
  { href: '/app/flashcards/topics', icon: Link2, titleKey: 'link_topics', descKey: 'link_topics_desc', color: 'emerald' },
  { href: '/app/flashcards/study', icon: RotateCcw, titleKey: 'continue_reviewing', descKey: 'continue_reviewing_desc', color: 'rose' },
] as const;

const navItems = [
  { href: '/app/flashcards/decks', icon: BookOpen, labelKey: 'all_decks' },
  { href: '/app/flashcards/topics', icon: Layers, labelKey: 'topics_label' },
  { href: '/app/statistics', icon: BarChart3, labelKey: 'study_history' },
  { href: '/app/settings', icon: Settings, labelKey: 'settings' },
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

  const { data: stats, isLoading } = useApiQuery<{
    totalDecks: number;
    totalFlashcards: number;
    flashcardAccuracy: number;
    dueToday: number;
  }>({
    queryKey: ['stats', 'student'],
    url: '/api/v1/stats/student',
  });

  const handleContinueReviewing = useCallback(() => router.push('/app/flashcards/study'), [router]);
  const handleCreateDeck = useCallback(() => router.push('/app/flashcards/decks'), [router]);

  return (
    <>
      {/* Hero */}
      <div className="bg-muted/30 pt-8 pb-6 border-b border-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 md:px-8">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            {todayStr}
          </p>
          <h1 className="text-5xl font-semibold mb-4 tracking-tight text-foreground">
            {t('hello_greeting', { name: userName })}
          </h1>
          <p className="text-lg text-muted-foreground mb-8">
            {t.rich('due_today', {
              count: stats?.dueToday ?? 0,
              strong: (chunks) => <span className="font-semibold text-foreground">{chunks}</span>,
            })}
          </p>

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

      {/* Content */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 md:px-8 py-12 grid grid-cols-1 lg:grid-cols-12 gap-16">
        {/* Left Column */}
        <div className="lg:col-span-7 space-y-12">
          {/* Stats */}
          <div className="grid grid-cols-3 gap-4">
            <StatCard title={t('total_decks')} value={isLoading ? '...' : String(stats?.totalDecks ?? 0)} icon={BookOpen} variant="blue" />
            <StatCard title={t('flashcards')} value={isLoading ? '...' : String(stats?.totalFlashcards ?? 0)} icon={Layers} variant="violet" />
            <StatCard title={t('accuracy')} value={isLoading ? '...' : `${stats?.flashcardAccuracy ?? 0}%`} icon={Target} variant="emerald" />
          </div>

          {/* Quick Actions */}
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

        {/* Right Column */}
        <div className="lg:col-span-5 space-y-12">
          {/* Chart */}
          <section>
            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-6">
              {t('reviews_this_week')}
            </h3>
            <div className="h-48 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 5, right: 0, left: -25, bottom: 0 }}>
                  <defs>
                    <linearGradient id="reviewsGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="var(--primary)" stopOpacity={0.25} />
                      <stop offset="95%" stopColor="var(--primary)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <XAxis
                    dataKey="name"
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                    dy={10}
                  />
                  <YAxis
                    axisLine={false}
                    tickLine={false}
                    tick={{ fontSize: 11, fill: 'var(--muted-foreground)' }}
                    domain={[0, 40]}
                    ticks={[0, 10, 20, 30, 40]}
                  />
                  <Tooltip />
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke="var(--primary)"
                    strokeWidth={2}
                    fillOpacity={1}
                    fill="url(#reviewsGrad)"
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </section>

          {/* Navigate */}
          <section>
            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-5">
              {t('navigate')}
            </h3>
            <div className="space-y-2">
              {navItems.map(({ href, icon: Icon, labelKey }) => (
                <Link
                  key={labelKey}
                  href={href}
                  className="group flex items-center gap-3 p-3 rounded-xl hover:bg-muted/60 border border-transparent hover:border-border/60 transition-all duration-150"
                >
                  <div className="rounded-lg bg-primary/10 p-2.5 shrink-0">
                    <Icon className="h-4 w-4 text-primary" />
                  </div>
                  <span className="font-semibold text-sm text-foreground/80 group-hover:text-foreground transition-colors">
                    {t(labelKey)}
                  </span>
                  <ArrowRight className="h-4 w-4 text-muted-foreground ml-auto group-hover:translate-x-1 transition-transform duration-200" />
                </Link>
              ))}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}
