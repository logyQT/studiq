'use client';

import { useTranslations } from 'next-intl';
import { FolderOpen, Tags, BarChart3 } from 'lucide-react';
import { DashboardPanel } from '@/components/flashcards';
import { useApiQuery } from '@/hooks/use-api';
import { flashcardKeys } from '@/lib/query-keys';
import type { Deck, Topic } from '@/types/flashcards';
import { PANEL_GRADIENTS } from '@/lib/color-utils';

export default function EduFlashcardsClient() {
  const t = useTranslations('EduFlashcardsPage');
  const { data: decksData } = useApiQuery<{ items: Deck[]; nextCursor: string | null; hasMore: boolean }>({ queryKey: flashcardKeys.decks.all, url: '/api/v1/flashcards/decks?limit=200' });
  const { data: topicsData } = useApiQuery<{ items: Topic[]; nextCursor: string | null; hasMore: boolean }>({ queryKey: flashcardKeys.topics.all, url: '/api/v1/flashcards/topics?limit=200' });
  const decks = decksData?.items;
  const topics = topicsData?.items;

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
      gradient: PANEL_GRADIENTS['decks'],
    },
    {
      id: 'topics',
      icon: Tags,
      title: t('topics_title'),
      description: t('topics_desc'),
      href: '/edu/flashcards/topics',
      count: topicCount,
      countLabel: t('topics_count', { count: topicCount }),
      gradient: PANEL_GRADIENTS['topics'],
    },
    {
      id: 'stats',
      icon: BarChart3,
      title: t('stats_title'),
      description: t('stats_desc'),
      href: '/edu/flashcards/stats',
      gradient: PANEL_GRADIENTS['stats'],
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
