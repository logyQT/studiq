import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { FolderOpen, Tags } from 'lucide-react';

function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border animate-pulse">
      <div className="h-4 w-4 rounded bg-muted" />
      <div className="flex-1 space-y-2">
        <div className="h-4 w-32 rounded bg-muted" />
        <div className="h-3 w-16 rounded bg-muted" />
      </div>
    </div>
  );
}

export default function FlashcardsLoading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between animate-pulse">
        <div className="h-8 w-32 rounded bg-muted" />
        <div className="h-10 w-40 rounded bg-muted" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Tags className="h-5 w-5 text-muted-foreground" />
              <div className="h-6 w-20 rounded bg-muted" />
            </CardTitle>
            <div className="h-4 w-48 rounded bg-muted mt-2" />
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FolderOpen className="h-5 w-5 text-muted-foreground" />
              <div className="h-6 w-24 rounded bg-muted" />
            </CardTitle>
            <div className="h-4 w-48 rounded bg-muted mt-2" />
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <div className="h-6 w-32 rounded bg-muted" />
          <div className="h-4 w-48 rounded bg-muted mt-2" />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-4">
            <div className="flex-1 h-20 rounded-lg border bg-muted animate-pulse" />
            <div className="flex-1 h-20 rounded-lg border bg-muted animate-pulse" />
          </div>
          <div className="flex items-center justify-between pt-2 animate-pulse">
            <div className="h-4 w-40 rounded bg-muted" />
            <div className="h-10 w-36 rounded bg-muted" />
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
