export default function EduTopicsLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className="h-9 w-20 rounded bg-muted animate-pulse" />
          <div className="h-8 w-40 rounded bg-muted animate-pulse" />
        </div>
        <div className="h-9 w-28 rounded bg-muted animate-pulse" />
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="rounded-lg border p-5 animate-pulse">
            <div className="flex items-start justify-between">
              <div className="h-10 w-10 rounded-lg bg-muted" />
              <div className="h-7 w-7 rounded bg-muted" />
            </div>
            <div className="h-5 w-32 rounded bg-muted mt-3" />
            <div className="h-5 w-24 rounded bg-muted mt-2" />
            <div className="h-8 w-full rounded bg-muted mt-3" />
          </div>
        ))}
      </div>
    </div>
  );
}
