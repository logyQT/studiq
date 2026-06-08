import { Skeleton } from '@/components/ui/skeleton';

const GRADIENTS = [
  'from-violet-400 to-purple-500',
  'from-blue-400 to-cyan-500',
  'from-emerald-400 to-teal-500',
  'from-orange-400 to-amber-500',
  'from-pink-400 to-rose-500',
  'from-indigo-400 to-blue-500',
];

function FlashcardSkeleton() {
  return (
    <div className="min-h-48 rounded-xl border bg-card p-6 flex flex-col items-center justify-center space-y-3">
      <Skeleton className="h-3 w-16" />
      <Skeleton className="h-6 w-3/4" />
      <div className="mt-auto pt-4 w-full flex gap-1">
        <Skeleton className="h-4 w-14 rounded-full" />
        <Skeleton className="h-4 w-16 rounded-full" />
      </div>
    </div>
  );
}

export default function DeckViewLoading() {
  return (
    <div className="space-y-6">
      <Skeleton className="h-8 w-16" />

      <div className="rounded-xl bg-gradient-to-br from-violet-400 to-purple-500 p-8">
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
        {GRADIENTS.map((_, i) => (
          <FlashcardSkeleton key={i} />
        ))}
      </div>
    </div>
  );
}
