'use client';

import { useTranslations } from 'next-intl';
import { FolderOpen, Tags, Play, Sparkles, BookOpen, RotateCcw, AlertTriangle } from 'lucide-react';
import { DashboardPanel } from '@/components/flashcards/dashboard-panel';
import { StatCard } from '@/components/ui/stat-card';
import { useApiQuery } from '@/hooks/use-api';
import { flashcardKeys } from '@/lib/query-keys';
import type { Deck, Topic } from '@/types/flashcards';

interface StateBreakdown {
  totalCards: number;
  neverPracticed: number;
  learning: number;
  review: number;
  relearning: number;
  leeched: number;
}

const GRADIENTS = [
  'from-violet-500 to-purple-600',
  'from-blue-500 to-cyan-500',
  'from-emerald-500 to-teal-600',
  'from-orange-500 to-amber-600',
  'from-pink-500 to-rose-600',
  'from-indigo-500 to-blue-600',
  'from-fuchsia-500 to-pink-600',
  'from-lime-500 to-green-600',
  'from-red-500 to-orange-500',
  'from-sky-500 to-indigo-500',
  'from-yellow-500 to-orange-500',
  'from-teal-500 to-emerald-600',
];

export default function FlashcardsClient() {
  const t = useTranslations('AppFlashcardsPage');
  const { data: decks } = useApiQuery<Deck[]>({
    queryKey: flashcardKeys.decks.all,
    url: '/api/v1/flashcards/decks',
  });
  const { data: topics } = useApiQuery<Topic[]>({
    queryKey: flashcardKeys.topics.all,
    url: '/api/v1/flashcards/topics',
  });
  const { data: dueData } = useApiQuery<{ count: number }>({
    queryKey: [...flashcardKeys.all, 'practice', 'due', 'count'],
    url: '/api/v1/flashcards/practice/due/count',
  });

  const { data: stateBreakdown } = useApiQuery<StateBreakdown>({
    queryKey: [...flashcardKeys.all, 'practice', 'states'],
    url: '/api/v1/flashcards/practice/states',
  });

  const deckCount = decks?.length ?? 0;
  const topicCount = topics?.length ?? 0;
  const dueCount = dueData?.count ?? 0;

  const panels = [
    {
      id: 'decks',
      icon: FolderOpen,
      title: t('decks_title'),
      description: t('decks_desc'),
      href: '/app/flashcards/decks',
      count: deckCount,
      countLabel: t('decks_count', { count: deckCount }),
      gradient: GRADIENTS[0],
    },
    {
      id: 'topics',
      icon: Tags,
      title: t('topics_title'),
      description: t('topics_desc'),
      href: '/app/flashcards/topics',
      count: topicCount,
      countLabel: t('topics_count', { count: topicCount }),
      gradient: GRADIENTS[4],
    },
    {
      id: 'study',
      icon: Play,
      title: t('review_title'),
      description: t('review_desc'),
      href: '/app/flashcards/study',
      count: dueCount,
      countLabel: t('review_count', { count: dueCount }),
      gradient: GRADIENTS[8],
    },
  ];

  return (
    <div className="space-y-6">
      {/* <div className="space-y-1">
        <p className="text-muted-foreground">{t('subtitle')}</p>
      </div> */}

      <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <StatCard
          title={t('state_total')}
          value={stateBreakdown?.totalCards ?? '...'}
          icon={BookOpen}
          variant="blue"
        />
        <StatCard
          title={t('state_new')}
          value={stateBreakdown?.neverPracticed ?? '...'}
          icon={Sparkles}
          variant="violet"
        />
        <StatCard
          title={t('state_learning')}
          value={stateBreakdown?.learning ?? '...'}
          icon={Play}
          variant="amber"
        />
        <StatCard
          title={t('state_review')}
          value={stateBreakdown?.review ?? '...'}
          icon={RotateCcw}
          variant="emerald"
        />
        <StatCard
          title={t('state_relearning')}
          value={stateBreakdown?.relearning ?? '...'}
          icon={AlertTriangle}
          variant="rose"
        />
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {panels.map((panel) => (
          <DashboardPanel key={panel.id} {...panel} />
        ))}
      </div>
    </div>
  );
}
