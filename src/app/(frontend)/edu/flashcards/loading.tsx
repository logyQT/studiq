import { FolderOpen, Tags, BarChart3 } from 'lucide-react';

const GRADIENTS = [
  'from-violet-500 to-purple-600',
  'from-blue-500 to-cyan-500',
  'from-emerald-500 to-teal-600',
  'from-orange-500 to-amber-600',
  'from-pink-500 to-rose-600',
  'from-indigo-500 to-blue-600',
  'from-fuchsia-500 to-pink-600',
  'from-lime-500 to-green-600',
  'from-red-500 to-orange-500',
  'from-sky-500 to-indigo-500',
  'from-yellow-500 to-orange-500',
  'from-teal-500 to-emerald-600',
];

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
