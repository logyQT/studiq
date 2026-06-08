import { Skeleton } from '@/components/ui/skeleton';

function PanelSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className="h-24 bg-gradient-to-br from-gray-300 to-gray-400 dark:from-gray-600 dark:to-gray-700 flex items-center justify-center">
        <Skeleton className="h-10 w-10 rounded-full bg-gray-400/30 dark:bg-gray-500/30" />
      </div>
      <div className="p-5 space-y-2">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-3 w-20" />
      </div>
    </div>
  );
}

export default function FlashcardsLoading() {
  return (
    <div className="space-y-6">
      <div className="space-y-2">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-4 w-64" />
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <PanelSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
