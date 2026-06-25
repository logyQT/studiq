'use client';

import { useTranslations } from 'next-intl';
import { FolderOpen, Tags, BarChart3 } from 'lucide-react';
import { DashboardPanel } from '@/components/flashcards';
import { useApiQuery } from '@/hooks/use-api';
import { flashcardKeys } from '@/lib/query-keys';
import type { Deck, Topic } from '@/types/flashcards';
import { GRADIENTS } from '@/lib/color-utils';

export default function EduFlashcardsClient() {
  const t = useTranslations('EduFlashcardsPage');
  const { data: decks } = useApiQuery<Deck[]>({ queryKey: flashcardKeys.decks.all, url: '/api/v1/flashcards/decks' });
  const { data: topics } = useApiQuery<Topic[]>({ queryKey: flashcardKeys.topics.all, url: '/api/v1/flashcards/topics' });

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
