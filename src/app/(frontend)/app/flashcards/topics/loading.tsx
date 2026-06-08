import { Skeleton } from '@/components/ui/skeleton';

function TopicCardSkeleton() {
  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex items-start justify-between">
        <Skeleton className="h-10 w-10 rounded-lg bg-gray-300 dark:bg-gray-600" />
        <Skeleton className="h-7 w-7 rounded" />
      </div>
      <Skeleton className="h-5 w-24 mt-3" />
      <Skeleton className="h-5 w-20 rounded-full mt-2" />
      <Skeleton className="h-8 w-full mt-3" />
    </div>
  );
}

export default function TopicsLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-8 w-40" />
        </div>
        <Skeleton className="h-9 w-28" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <TopicCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
