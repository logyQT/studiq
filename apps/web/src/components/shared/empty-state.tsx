import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@studiq/ui';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  /** What the user can do about it: usually a button that creates the first item. */
  action?: React.ReactNode;
  /** Tighter padding for a table cell or a card, instead of a whole page. */
  compact?: boolean;
  className?: string;
}

/**
 * The one empty state of the list pages (#666): an icon, what is missing, why or what to do,
 * and an optional primary action. Built on the `Empty` primitive, so lists that already use it
 * (decks, topics, question banks) look the same as the ones that do not yet.
 */
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  compact = false,
  className,
}: EmptyStateProps) {
  return (
    <Empty className={cn(compact ? 'gap-4 p-6 md:p-6' : 'py-16', className)} role="status">
      <EmptyHeader>
        {Icon && (
          <EmptyMedia variant="icon">
            <Icon aria-hidden="true" />
          </EmptyMedia>
        )}
        <EmptyTitle>{title}</EmptyTitle>
        {description && <EmptyDescription>{description}</EmptyDescription>}
      </EmptyHeader>
      {action && <EmptyContent>{action}</EmptyContent>}
    </Empty>
  );
}
