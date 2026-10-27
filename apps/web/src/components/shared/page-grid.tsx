import type { ReactNode, RefObject } from 'react';
import { EmptyState, ErrorState, NoResultsState } from '@/components/shared/empty-state';
import type { ListEmptyView } from '@/lib/list-empty-view';

interface PageGridProps {
  cols?: 3 | 4;
  isLoading?: boolean;
  skeleton?: ReactNode;
  skeletonCount?: number;
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  loadMoreRef?: RefObject<HTMLDivElement | null>;
  isEmpty?: boolean;
  emptyIcon?: ReactNode;
  emptyTitle?: string;
  emptyAction?: ReactNode;
  /** The list failed to load: shown instead of the rows and of any empty state. */
  isError?: boolean;
  onRetry?: () => void;
  /** When a search or filter hid every row, the grid names it instead of the collection copy. */
  emptyView?: ListEmptyView;
  onClearFilters?: () => void;
  children?: ReactNode;
}

export function PageGrid({
  cols = 3,
  isLoading,
  skeleton,
  skeletonCount = 8,
  hasNextPage,
  isFetchingNextPage,
  loadMoreRef,
  isEmpty,
  emptyIcon,
  emptyTitle,
  emptyAction,
  isError,
  onRetry,
  emptyView,
  onClearFilters,
  children,
}: PageGridProps) {
  const gridCols =
    cols === 4
      ? 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
      : 'grid gap-4 sm:grid-cols-2 lg:grid-cols-3';

  if (isLoading && skeleton) {
    return (
      <div className={gridCols}>
        {Array.from({ length: skeletonCount }).map((_, i) => (
          <div key={i}>{skeleton}</div>
        ))}
      </div>
    );
  }

  // A failed first load has no rows to keep on screen: say so instead of drawing an empty list.
  if (isError && onRetry && isEmpty) {
    return (
      <div className={gridCols}>
        <ErrorState onRetry={onRetry} className="col-span-full" />
      </div>
    );
  }

  return (
    <div className={gridCols}>
      {children}
      {hasNextPage &&
        isFetchingNextPage &&
        skeleton &&
        Array.from({ length: skeletonCount }).map((_, i) => (
          <div key={`skel-${i}`}>{skeleton}</div>
        ))}
      {loadMoreRef && <div ref={loadMoreRef} className="min-h-px" />}
      {isEmpty &&
        !isFetchingNextPage &&
        (emptyView?.kind === 'no-results' && onClearFilters ? (
          <NoResultsState
            query={emptyView.query}
            onClear={onClearFilters}
            className="col-span-full"
          />
        ) : (
          <EmptyState
            media={emptyIcon}
            title={emptyTitle ?? ''}
            action={emptyAction}
            className="col-span-full"
          />
        ))}
    </div>
  );
}
