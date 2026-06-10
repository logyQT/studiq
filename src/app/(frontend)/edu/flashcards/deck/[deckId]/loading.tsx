import { Skeleton } from '@/components/ui/skeleton';

function FlashcardSkeleton() {
  return (
    <div className="min-h-32 rounded-xl border bg-card p-6 flex flex-col space-y-3">
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-4 w-1/2" />
      <div className="flex gap-1 mt-auto pt-2">
        <Skeleton className="h-5 w-14 rounded-full" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
    </div>
  );
}

export default function EduDeckViewLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-9 w-20" />

      <div className="rounded-xl bg-gradient-to-br from-gray-300 to-gray-400 dark:from-gray-600 dark:to-gray-700 p-8">
        <div className="flex items-start gap-4">
          <Skeleton className="h-14 w-14 rounded-lg bg-white/20" />
          <div className="flex-1 space-y-3">
            <Skeleton className="h-8 w-48 bg-white/20" />
            <Skeleton className="h-4 w-64 bg-white/20" />
            <Skeleton className="h-5 w-24 rounded-full bg-white/20" />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="space-y-2">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-9 w-32" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <FlashcardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
