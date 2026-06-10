import { Skeleton } from '@/components/ui/skeleton';

function DeckCardSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="h-20 bg-gradient-to-br from-gray-300 to-gray-400 dark:from-gray-600 dark:to-gray-700 flex items-center justify-center">
        <Skeleton className="h-8 w-8 rounded bg-gray-400/30 dark:bg-gray-500/30" />
      </div>
      <div className="p-4 space-y-3">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="h-3 w-40" />
        <div className="flex items-center justify-between pt-2">
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-7 w-24" />
        </div>
      </div>
    </div>
  );
}

export default function PracticeLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Skeleton className="h-8 w-16" />
        <Skeleton className="h-8 w-40" />
      </div>
      <Skeleton className="h-4 w-64" />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <DeckCardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
