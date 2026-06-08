import { Skeleton } from '@/components/ui/skeleton';

const GRADIENTS = [
  'from-violet-400 to-purple-500',
  'from-blue-400 to-cyan-500',
  'from-emerald-400 to-teal-500',
  'from-orange-400 to-amber-500',
  'from-pink-400 to-rose-500',
  'from-indigo-400 to-blue-500',
];

function DeckCardSkeleton({ gradient }: { gradient: string }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className={`h-20 bg-gradient-to-br ${gradient} flex items-center justify-center`}>
        <Skeleton className="h-8 w-8 rounded bg-white/20" />
      </div>
      <div className="p-4 space-y-3">
        <div className="flex items-start justify-between">
          <div className="space-y-2 flex-1">
            <Skeleton className="h-5 w-32" />
            <Skeleton className="h-3 w-40" />
          </div>
          <div className="flex gap-1 ml-2">
            <Skeleton className="h-7 w-7 rounded" />
            <Skeleton className="h-7 w-7 rounded" />
          </div>
        </div>
        <div className="flex items-center justify-between">
          <Skeleton className="h-5 w-20 rounded-full" />
          <Skeleton className="h-7 w-16" />
        </div>
      </div>
    </div>
  );
}

export default function DecksLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Skeleton className="h-8 w-16" />
          <Skeleton className="h-8 w-40" />
        </div>
        <Skeleton className="h-9 w-28" />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {GRADIENTS.map((g, i) => (
          <DeckCardSkeleton key={i} gradient={g} />
        ))}
      </div>
    </div>
  );
}
