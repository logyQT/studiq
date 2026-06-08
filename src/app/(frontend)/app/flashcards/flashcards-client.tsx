'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { FolderOpen, Tags, Play } from 'lucide-react';

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

interface FlashcardsClientProps {
  topicCount: number;
  deckCount: number;
}

export default function FlashcardsClient({ topicCount, deckCount }: FlashcardsClientProps) {
  const t = useTranslations('AppFlashcardsPage');

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
      id: 'practice',
      icon: Play,
      title: t('practice_title'),
      description: t('practice_desc'),
      href: '/app/flashcards/practice',
      count: null,
      countLabel: '',
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
        {panels.map((panel) => {
          const Icon = panel.icon;
          return (
            <Link
              key={panel.id}
              href={panel.href}
              className="group relative overflow-hidden rounded-xl border bg-card transition-all duration-200 hover:scale-[1.02] hover:shadow-lg hover:border-primary/50"
            >
              <div className={`h-24 bg-gradient-to-br ${panel.gradient} flex items-center justify-center`}>
                <Icon className="h-10 w-10 text-white/90 transition-transform duration-200 group-hover:scale-110" />
              </div>
              <div className="p-5">
                <h3 className="text-lg font-semibold">{panel.title}</h3>
                <p className="text-sm text-muted-foreground mt-1">{panel.description}</p>
                {panel.count !== null && (
                  <p className="text-xs text-muted-foreground mt-3">{panel.countLabel}</p>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
