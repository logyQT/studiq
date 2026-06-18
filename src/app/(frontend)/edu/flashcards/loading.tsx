

import { GRADIENTS } from '@/lib/color-utils';

function SkeletonPanel({ gradient }: { gradient: string }) {
  return (
    <div className="rounded-xl border bg-card overflow-hidden animate-pulse">
      <div className={`h-24 bg-gradient-to-br ${gradient} flex items-center justify-center`}>
        <div className="h-10 w-10 rounded-full bg-white/20" />
      </div>
      <div className="p-5 space-y-3">
        <div className="h-5 w-24 rounded bg-muted" />
        <div className="h-4 w-40 rounded bg-muted" />
        <div className="h-3 w-20 rounded bg-muted mt-auto" />
      </div>
    </div>
  );
}

export default function EduFlashcardsLoading() {
  return (
    <div className="space-y-6">
      <div>
        <div className="h-8 w-32 rounded bg-muted animate-pulse" />
        <div className="h-4 w-64 rounded bg-muted mt-2 animate-pulse" />
      </div>
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <SkeletonPanel gradient={GRADIENTS[0]} />
        <SkeletonPanel gradient={GRADIENTS[4]} />
        <SkeletonPanel gradient={GRADIENTS[8]} />
      </div>
    </div>
  );
}
