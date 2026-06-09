'use client';

import { useTranslations } from 'next-intl';
import { FolderOpen, Tags, BarChart3 } from 'lucide-react';
import { DashboardPanel } from '@/components/flashcards/dashboard-panel';
import { useDecks, useTopics } from '@/hooks/use-flashcard-queries';

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

export default function EduFlashcardsClient() {
  const t = useTranslations('EduFlashcardsPage');
  const { data: decks } = useDecks();
  const { data: topics } = useTopics();

  const deckCount = decks?.length ?? 0;
  const topicCount = topics?.length ?? 0;

  const panels = [
    {
      id: 'decks',
      icon: FolderOpen,
      title: t('decks_title'),
      description: t('decks_desc'),
      href: '/edu/flashcards/decks',
      count: deckCount,
      countLabel: t('decks_count', { count: deckCount }),
      gradient: GRADIENTS[0],
    },
    {
      id: 'topics',
      icon: Tags,
      title: t('topics_title'),
      description: t('topics_desc'),
      href: '/edu/flashcards/topics',
      count: topicCount,
      countLabel: t('topics_count', { count: topicCount }),
      gradient: GRADIENTS[4],
    },
    {
      id: 'stats',
      icon: BarChart3,
      title: t('stats_title'),
      description: t('stats_desc'),
      href: '/edu/flashcards/stats',
      gradient: GRADIENTS[8],
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold">{t('title')}</h2>
        <p className="text-muted-foreground mt-1">{t('subtitle')}</p>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {panels.map((panel) => (
          <DashboardPanel key={panel.id} {...panel} />
        ))}
      </div>
    </div>
  );
}
