import { GRADIENTS } from '@/lib/color-utils';

export default function EduDecksLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="h-9 w-20 rounded bg-muted animate-pulse" />
          <div className="h-8 w-36 rounded bg-muted animate-pulse" />
        </div>
        <div className="h-9 w-24 rounded bg-muted animate-pulse" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-lg border p-5 animate-pulse">
            <div className="flex items-start gap-3">
              <div
                className={`h-10 w-10 rounded-lg bg-gradient-to-br ${GRADIENTS[i % GRADIENTS.length]} shrink-0`}
              />
              <div className="flex-1 space-y-2">
                <div className="h-5 w-32 rounded bg-muted" />
                <div className="h-4 w-48 rounded bg-muted" />
              </div>
            </div>
            <div className="mt-3 flex items-center justify-between">
              <div className="h-5 w-24 rounded bg-muted" />
              <div className="h-5 w-16 rounded bg-muted" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
