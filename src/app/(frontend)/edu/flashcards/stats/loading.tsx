export default function EduStatsLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <div className="h-9 w-20 rounded bg-muted animate-pulse" />
        <div className="h-8 w-48 rounded bg-muted animate-pulse" />
      </div>
      <div className="flex flex-col items-center justify-center py-24">
        <div className="h-16 w-16 rounded-full bg-muted animate-pulse mb-6" />
        <div className="h-6 w-32 rounded bg-muted animate-pulse" />
        <div className="h-4 w-64 rounded bg-muted mt-2" />
      </div>
    </div>
  );
}
