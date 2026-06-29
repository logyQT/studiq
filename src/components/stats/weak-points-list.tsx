'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';

interface WeakItem {
  name: string;
  accuracy: number;
  totalAttempts: number;
}

interface WeakPointsListProps {
  items: WeakItem[];
  type: 'deck' | 'topic';
}

export function WeakPointsList({ items, type }: WeakPointsListProps) {
  const t = useTranslations('AppStatsPage');

  if (items.length === 0) {
    return (
      <p className="text-sm text-muted-foreground text-center py-8">
        {type === 'deck' ? t('no_weak_decks') : t('no_weak_topics')}
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {items.map((item, index) => (
        <div key={index} className="flex items-center justify-between gap-4">
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{item.name}</p>
            <p className="text-xs text-muted-foreground">{t('attempts_count', { count: item.totalAttempts })}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="h-2 w-24 rounded-full bg-muted overflow-hidden">
              <div
                className={cn(
                  'h-full rounded-full transition-all',
                  item.accuracy >= 80 ? 'bg-emerald-500' : item.accuracy >= 50 ? 'bg-amber-500' : 'bg-rose-500',
                )}
                style={{ width: `${item.accuracy}%` }}
              />
            </div>
            <span
              className={cn(
                'text-sm font-medium tabular-nums w-10 text-right',
                item.accuracy >= 80 ? 'text-emerald-600' : item.accuracy >= 50 ? 'text-amber-600' : 'text-rose-600',
              )}
            >
              {item.accuracy}%
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}
