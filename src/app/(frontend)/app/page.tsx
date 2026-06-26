'use client';

import { useMemo, useCallback, type ComponentType } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { useTranslations, useLocale } from 'next-intl';
import { Plus, BookOpen, Layers, Link as LinkIcon, RotateCcw } from 'lucide-react';
import { Area, AreaChart, ResponsiveContainer, XAxis, YAxis, Tooltip } from 'recharts';

const chartData = [
  { name: 'Mon', value: 12 },
  { name: 'Tue', value: 28 },
  { name: 'Wed', value: 18 },
  { name: 'Thu', value: 36 },
  { name: 'Fri', value: 22 },
  { name: 'Sat', value: 43 },
  { name: 'Sun', value: 31 },
];

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

  const handleContinueReviewing = useCallback(
    () => router.push('/app/flashcards/study'),
    [router],
  );

  const handleCreateDeck = useCallback(
    () => router.push('/app/flashcards/decks'),
    [router],
  );

  return (
    <>
      {/* Hero */}
      <div className="bg-muted/30 pt-12 pb-10 border-b border-border">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 md:px-8">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            {todayStr}
          </p>
          <h1 className="text-5xl font-semibold mb-4 tracking-tight text-foreground">
            {t('hello_greeting', { name: 'Alex' })}
          </h1>
          <p className="text-lg text-muted-foreground mb-8">
            {t.rich('due_today', {
              count: 14,
              strong: (chunks) => <span className="font-semibold text-foreground">{chunks}</span>,
            })}
          </p>

          <div className="flex flex-wrap items-center gap-4">
            <button
              onClick={handleContinueReviewing}
              className="flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground px-5 py-2.5 rounded-xl font-medium transition-colors text-sm shadow-sm"
            >
              <RotateCcw className="w-4 h-4" />
              {t('continue_reviewing')}
            </button>
            <button
              onClick={handleCreateDeck}
              className="flex items-center gap-2 bg-background hover:bg-muted/50 border border-border text-foreground px-5 py-2.5 rounded-xl font-medium transition-colors text-sm shadow-sm"
            >
              <Plus className="w-4 h-4" />
              {t('create_deck')}
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-6xl mx-auto px-4 sm:px-6 md:px-8 py-12 grid grid-cols-1 lg:grid-cols-12 gap-16">
        {/* Left Column */}
        <div className="lg:col-span-7 space-y-12">
          {/* Stats Row */}
          <div className="flex items-center justify-between gap-x-8">
            <StatItem value="12" label={t('total_decks')} />
            <div className="w-px h-10 bg-border hidden sm:block" />
            <StatItem value="284" label={t('flashcards')} />
            <div className="w-px h-10 bg-border hidden sm:block" />
            <StatItem
              value={
                <>
                  7 <span className="text-xl">🔥</span>
                </>
              }
              label={t('day_streak')}
            />
            <div className="w-px h-10 bg-border hidden sm:block" />
            <StatItem value="65%" label={t('accuracy')} />
          </div>

          {/* Quick Actions */}
          <section>
            <h3 className="text-xs font-bold text-muted-foreground uppercase tracking-widest mb-4">
              {t('quick_actions')}
            </h3>
            <div className="border border-border rounded-2xl bg-muted/30 overflow-hidden">
              <QuickActionLink
                href="/app/flashcards/decks"
                icon={Plus}
                title={t('create_deck')}
                description={t('create_deck_desc')}
              />
              <QuickActionLink
                href="/app/flashcards/decks"
                icon={BookOpen}
                title={t('create_flashcard')}
                description={t('create_flashcard_desc')}
              />
              <QuickActionLink
                href="/app/flashcards/topics"
                icon={Layers}
                title={t('create_topic')}
                description={t('create_topic_desc')}
              />
              <QuickActionLink
                href="/app/flashcards/topics"
                icon={LinkIcon}
                title={t('link_topics')}
                description={t('link_topics_desc')}
              />
              <QuickActionLink
                href="/app/flashcards/study"
                icon={RotateCcw}
                title={t('continue_reviewing')}
                description={t('continue_reviewing_desc')}
                noBorder
              />
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
            <div className="space-y-4">
              <NavLink href="/app/flashcards/decks" label={t('all_decks')} />
              <NavLink href="/app/flashcards/topics" label={t('topics_label')} />
              <NavLink href="/app/statistics" label={t('study_history')} />
              <NavLink href="/app/settings" label={t('settings')} />
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

/* ── Sub-components ── */

function StatItem({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className="shrink-0">
      <div className="text-[32px] font-semibold leading-tight mb-1 text-foreground whitespace-nowrap">{value}</div>
      <div className="text-[13px] text-muted-foreground whitespace-nowrap">{label}</div>
    </div>
  );
}

function QuickActionLink({
  href,
  icon: Icon,
  title,
  description,
  noBorder = false,
}: {
  href: string;
  icon: ComponentType<{ className?: string; strokeWidth?: number }>;
  title: string;
  description: string;
  noBorder?: boolean;
}) {
  return (
    <Link
      href={href}
      className={`flex items-center gap-4 p-4 hover:bg-accent transition-colors group ${
        noBorder ? '' : 'border-b border-border'
      }`}
    >
      <div className="bg-primary/10 text-primary p-2.5 rounded-full group-hover:scale-105 transition-transform">
        <Icon className="w-4 h-4" strokeWidth={2.5} />
      </div>
      <div>
        <div className="font-semibold text-sm text-foreground">{title}</div>
        <div className="text-xs text-muted-foreground mt-0.5">{description}</div>
      </div>
    </Link>
  );
}

function NavLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="block text-sm text-foreground/80 hover:text-foreground font-medium transition-colors"
    >
      {label}
    </Link>
  );
}
