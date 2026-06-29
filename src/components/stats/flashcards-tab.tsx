'use client';

import { useState, useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { BookOpen, Sparkles, Play, RotateCcw, AlertTriangle, ChevronDown, ChevronUp, ArrowUpDown, Filter } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { StatCard } from '@/components/ui/stat-card';
import { useApiQuery } from '@/hooks/use-api';
import { flashcardKeys } from '@/lib/query-keys';
import { cn } from '@/lib/utils';

interface CardStatsItem {
  id: string;
  front: string;
  back: string;
  createdAt: string;
  state: 'new' | 'learning' | 'review' | 'relearning' | 'leech';
  totalAttempts: number;
  correctRate: number;
  lastPracticedAt: string | null;
  easinessFactor: number | null;
  intervalDays: number | null;
  nextReviewAt: string | null;
  repetitions: number | null;
  isLeech: boolean;
  learningStep: number | null;
  lapseCount: number | null;
}

interface CardStatsResponse {
  items: CardStatsItem[];
  nextCursor: string | null;
  hasMore: boolean;
}

interface StateBreakdown {
  totalCards: number;
  neverPracticed: number;
  learning: number;
  review: number;
  relearning: number;
  leeched: number;
}

const STATE_FILTERS = ['all', 'new', 'learning', 'review', 'relearning', 'leech'] as const;

function StateBadge({ state }: { state: CardStatsItem['state'] }) {
  const t = useTranslations('AppStatsPage');
  const variants: Record<CardStatsItem['state'], { label: string; variant: 'default' | 'secondary' | 'outline' | 'destructive' }> = {
    new: { label: t('state_new'), variant: 'secondary' },
    learning: { label: t('state_learning'), variant: 'default' },
    review: { label: t('state_review'), variant: 'outline' },
    relearning: { label: t('state_relearning'), variant: 'default' },
    leech: { label: t('state_leech'), variant: 'destructive' },
  };
  const v = variants[state] ?? variants.new;
  return <Badge variant={v.variant}>{v.label}</Badge>;
}

function ExpandableRow({ item }: { item: CardStatsItem }) {
  const t = useTranslations('AppStatsPage');
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <tr
        className="border-b border-border/50 hover:bg-muted/30 cursor-pointer transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <td className="py-3 px-4">
          <div className="flex items-center gap-2">
            <StateBadge state={item.state} />
            {item.state === 'leech' && <AlertTriangle className="h-3 w-3 text-destructive" />}
          </div>
        </td>
        <td className="py-3 px-4 max-w-[200px] truncate text-sm font-medium">{item.front}</td>
        <td className="py-3 px-4 text-sm tabular-nums">{item.totalAttempts}</td>
        <td className="py-3 px-4 text-sm tabular-nums">
          {item.totalAttempts > 0 ? (
            <span className={cn(item.correctRate >= 80 ? 'text-emerald-600' : item.correctRate >= 50 ? 'text-amber-600' : 'text-rose-600')}>
              {item.correctRate}%
            </span>
          ) : (
            <span className="text-muted-foreground">--</span>
          )}
        </td>
        <td className="py-3 px-4 text-sm tabular-nums">{item.easinessFactor?.toFixed(2) ?? '--'}</td>
        <td className="py-3 px-4 text-sm tabular-nums">{item.intervalDays ?? '--'}</td>
        <td className="py-3 px-4 text-right">
          <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </td>
      </tr>
      {expanded && (
        <tr className="border-b border-border/50 bg-muted/20">
          <td colSpan={7} className="p-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase mb-1">{t('question')}</p>
                <p className="text-sm">{item.front}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase mb-1">{t('answer')}</p>
                <p className="text-sm">{item.back}</p>
              </div>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-3">
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase mb-1">{t('repetitions')}</p>
                <p className="text-sm font-medium">{item.repetitions ?? 0}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase mb-1">{t('learning_step')}</p>
                <p className="text-sm font-medium">{item.learningStep ?? '--'}</p>
              </div>
              <div>
                <p className="text-xs font-medium text-muted-foreground uppercase mb-1">{t('lapse_count')}</p>
                <p className="text-sm font-medium">{item.lapseCount ?? 0}</p>
              </div>
            </div>
            {item.lastPracticedAt && (
              <p className="mt-3 text-xs text-muted-foreground">
                {t('last_practiced')}: {new Date(item.lastPracticedAt).toLocaleString()}
              </p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

export function FlashcardsTab() {
  const t = useTranslations('AppStatsPage');
  const td = useTranslations('AppFlashcardsPage');

  const [stateFilter, setStateFilter] = useState<string>('all');
  const [sortBy, setSortBy] = useState<string>('createdAt');

  const { data: cardsData, isLoading: cardsLoading } = useApiQuery<CardStatsResponse>({
    queryKey: [...flashcardKeys.all, 'practice', 'cards-stats', { state: stateFilter, sortBy }],
    url: `/api/v1/flashcards/practice/cards-stats?state=${stateFilter !== 'all' ? stateFilter : ''}&sortBy=${sortBy}&order=desc&limit=100`,
  });

  const { data: stateBreakdown } = useApiQuery<StateBreakdown>({
    queryKey: flashcardKeys.practice.states,
    url: '/api/v1/flashcards/practice/states',
  });

  const items = useMemo(() => cardsData?.items ?? [], [cardsData]);

  const summaryCards = useMemo(() => {
    const totalPracticed = items.filter((i) => i.totalAttempts > 0).length;
    const avgAccuracy = totalPracticed > 0
      ? Math.round(items.filter((i) => i.totalAttempts > 0).reduce((sum, i) => sum + i.correctRate, 0) / totalPracticed)
      : 0;
    const avgEF = items.filter((i) => i.easinessFactor).length > 0
      ? items.filter((i) => i.easinessFactor).reduce((sum, i) => sum + (i.easinessFactor ?? 0), 0) / items.filter((i) => i.easinessFactor).length
      : 0;

    return { totalPracticed, avgAccuracy, avgEF };
  }, [items]);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard
          title={t('total_cards')}
          value={stateBreakdown?.totalCards ?? '...'}
          icon={BookOpen}
          variant="blue"
        />
        <StatCard
          title={t('practiced_cards')}
          value={summaryCards.totalPracticed}
          icon={Play}
          variant="emerald"
        />
        <StatCard
          title={t('average_accuracy')}
          value={summaryCards.totalPracticed > 0 ? `${summaryCards.avgAccuracy}%` : '--'}
          icon={Sparkles}
          variant="violet"
        />
        <StatCard
          title={t('average_easiness')}
          value={summaryCards.avgEF > 0 ? summaryCards.avgEF.toFixed(2) : '--'}
          icon={RotateCcw}
          variant="amber"
        />
        <StatCard
          title={t('review_state_new')}
          value={stateBreakdown?.neverPracticed ?? '...'}
          icon={Sparkles}
          variant="blue"
        />
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        <Filter className="h-4 w-4 text-muted-foreground" />
        {STATE_FILTERS.map((f) => (
          <Button
            key={f}
            variant={stateFilter === f ? 'default' : 'outline'}
            size="sm"
            onClick={() => setStateFilter(f)}
          >
            {td(`state_${f === 'all' ? 'total' : f}`)}
          </Button>
        ))}
        <div className="ml-auto flex items-center gap-2">
          <ArrowUpDown className="h-4 w-4 text-muted-foreground" />
          <select
            className="text-sm bg-background border border-border rounded-md px-2 py-1"
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value)}
          >
            <option value="createdAt">{t('sort_date')}</option>
            <option value="totalAttempts">{t('sort_attempts')}</option>
            <option value="correctRate">{t('sort_accuracy')}</option>
            <option value="easinessFactor">{t('sort_easiness')}</option>
          </select>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          {cardsLoading ? (
            <div className="p-6 space-y-4">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="p-12 text-center text-muted-foreground">{t('no_cards')}</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-border/50 bg-muted/30">
                    <th className="py-3 px-4 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('th_state')}</th>
                    <th className="py-3 px-4 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('th_front')}</th>
                    <th className="py-3 px-4 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('th_attempts')}</th>
                    <th className="py-3 px-4 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('th_accuracy')}</th>
                    <th className="py-3 px-4 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('th_ef')}</th>
                    <th className="py-3 px-4 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">{t('th_interval')}</th>
                    <th className="py-3 px-4" />
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <ExpandableRow key={item.id} item={item} />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
