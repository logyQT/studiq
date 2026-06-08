import { Skeleton } from '@/components/ui/skeleton';

const COLORS = ['bg-red-400', 'bg-blue-400', 'bg-green-400', 'bg-yellow-400', 'bg-purple-400', 'bg-pink-400', 'bg-indigo-400', 'bg-teal-400'];

function TopicCardSkeleton({ color }: { color: string }) {
  return (
    <div className="rounded-xl border bg-card p-5">
      <div className="flex items-start justify-between">
        <Skeleton className={`h-10 w-10 rounded-lg ${color}`} />
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
        {COLORS.map((c, i) => (
          <TopicCardSkeleton key={i} color={c} />
        ))}
      </div>
    </div>
  );
}
