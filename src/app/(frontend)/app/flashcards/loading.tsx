import { Skeleton } from '@/components/ui/skeleton';

const GRADIENTS = [
  'from-violet-400 to-purple-500',
  'from-pink-400 to-rose-500',
  'from-orange-400 to-amber-500',
];

function PanelSkeleton({ gradient }: { gradient: string }) {
  return (
    <div className="overflow-hidden rounded-xl border bg-card">
      <div className={`h-24 bg-gradient-to-br ${gradient} flex items-center justify-center`}>
        <Skeleton className="h-10 w-10 rounded-full bg-white/20" />
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

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {GRADIENTS.map((g, i) => (
          <PanelSkeleton key={i} gradient={g} />
        ))}
      </div>
    </div>
  );
}
