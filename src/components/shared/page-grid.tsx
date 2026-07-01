import type { ReactNode, RefObject } from 'react';
import { Empty, EmptyDescription, EmptyMedia, EmptyTitle } from '@/components/ui/empty';

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
      {isEmpty && !isFetchingNextPage && (
        <Empty className="col-span-full">
          {emptyIcon && <EmptyMedia>{emptyIcon}</EmptyMedia>}
          {emptyTitle && <EmptyTitle>{emptyTitle}</EmptyTitle>}
          {emptyAction && <EmptyDescription>{emptyAction}</EmptyDescription>}
        </Empty>
      )}
    </div>
  );
}
