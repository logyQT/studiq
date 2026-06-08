import { Skeleton } from '@/components/ui/skeleton';
import { Card, CardContent } from '@/components/ui/card';

export default function SessionLoading() {
  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center justify-between">
        <Skeleton className="h-9 w-28" />
        <Skeleton className="h-6 w-24" />
      </div>

      <Card className="min-h-64 flex items-center justify-center">
        <CardContent className="pt-8 text-center px-8 space-y-4">
          <Skeleton className="h-3 w-20 mx-auto" />
          <Skeleton className="h-8 w-3/4 mx-auto" />
          <Skeleton className="h-4 w-32 mx-auto" />
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-2">
        <Skeleton className="h-10 rounded-md" />
        <Skeleton className="h-10 rounded-md" />
        <Skeleton className="h-10 rounded-md" />
        <Skeleton className="h-10 rounded-md" />
      </div>
    </div>
  );
}
