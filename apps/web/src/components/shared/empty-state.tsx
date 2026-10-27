'use client';

import {
  Button,
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@studiq/ui';
import { AlertCircle, type LucideIcon, SearchX } from 'lucide-react';
import { useTranslations } from 'next-intl';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon?: LucideIcon;
  /** An icon that is already rendered (for callers that build their own media). */
  media?: ReactNode;
  title: string;
  description?: string;
  /** What the user can do about it: usually a button that creates the first item. */
  action?: ReactNode;
  /** Tighter padding for a table cell or a card, instead of a whole page. */
  compact?: boolean;
  /** `alert` for a failure, so assistive technology announces it; `status` otherwise. */
  role?: 'status' | 'alert';
  className?: string;
}

/**
 * The one empty state of the list pages (#666): an icon, what is missing, why or what to do,
 * and an optional primary action. The title is a real heading. Built on the `Empty` primitive,
 * so every list (decks, topics, question banks, tables) looks the same.
 */
export function EmptyState({
  icon: Icon,
  media,
  title,
  description,
  action,
  compact = false,
  role = 'status',
  className,
}: EmptyStateProps) {
  return (
    <Empty className={cn(compact ? 'gap-4 p-6 md:p-6' : 'py-16', className)} role={role}>
      <EmptyHeader>
        {media ? (
          <EmptyMedia>{media}</EmptyMedia>
        ) : (
          Icon && (
            <EmptyMedia variant="icon">
              <Icon aria-hidden="true" />
            </EmptyMedia>
          )
        )}
        <EmptyTitle role="heading" aria-level={3}>
          {title}
        </EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  );
}

interface ErrorStateProps {
  onRetry: () => void;
  compact?: boolean;
  className?: string;
}

/**
 * A list that failed to load. It must never be drawn as "nothing here yet, create your first
 * item": a 500, a 403 or an offline request says so, and offers a retry.
 */
export function ErrorState({ onRetry, compact = false, className }: ErrorStateProps) {
  const t = useTranslations('EmptyStates');

  return (
    <EmptyState
      icon={AlertCircle}
      title={t('load_error')}
      description={t('load_error_desc')}
      role="alert"
      compact={compact}
      className={className}
      action={
        <Button variant="outline" size="sm" onClick={onRetry}>
          {t('retry')}
        </Button>
      }
    />
  );
}

interface NoResultsStateProps {
  /** The active search text, if any; the copy names it. */
  query: string | null;
  onClear: () => void;
  compact?: boolean;
  className?: string;
}

/** A search or filter hid every row: say so and offer to reset it, instead of "create one". */
export function NoResultsState({
  query,
  onClear,
  compact = false,
  className,
}: NoResultsStateProps) {
  const t = useTranslations('EmptyStates');

  return (
    <EmptyState
      icon={SearchX}
      title={query ? t('no_results_query', { query }) : t('no_results_filters')}
      compact={compact}
      className={className}
      action={
        <Button variant="outline" size="sm" onClick={onClear}>
          {t('clear_filters')}
        </Button>
      }
    />
  );
}
