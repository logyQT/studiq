import { Skeleton } from '@/components/ui/skeleton';

function FlashcardSkeleton() {
  return (
    <>
      <div className="rounded-xl border bg-card p-3 space-y-2 sm:hidden">
        <div className="flex items-start justify-between gap-2">
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="h-7 w-7 rounded-md shrink-0" />
        </div>
        <Skeleton className="h-4 w-3/4" />
        <div className="flex gap-1">
          <Skeleton className="h-4 w-14 rounded-full" />
          <Skeleton className="h-4 w-16 rounded-full" />
        </div>
      </div>
      <div className="min-h-48 rounded-xl border bg-card p-6 flex flex-col items-center justify-center space-y-3 hidden sm:flex">
        <Skeleton className="h-3 w-16" />
        <Skeleton className="h-6 w-3/4" />
        <div className="mt-auto pt-4 w-full flex gap-1">
          <Skeleton className="h-4 w-14 rounded-full" />
          <Skeleton className="h-4 w-16 rounded-full" />
        </div>
      </div>
    </>
  );
}

export function DeckDetailSkeleton() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-4 w-16" />

      <div className="rounded-xl border bg-card p-6 flex items-start gap-4">
        <div className="flex flex-col items-center gap-2">
          <Skeleton className="h-14 w-14 rounded-lg" />
          <Skeleton className="h-5 w-12 rounded-full" />
        </div>
        <div className="flex-1 space-y-2 pt-1">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-64" />
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <Skeleton className="h-5 w-32" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-9 w-28" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <FlashcardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
