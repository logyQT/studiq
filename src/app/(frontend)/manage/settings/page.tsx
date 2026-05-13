'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';

interface University {
  id: string;
  name: string;
  slug: string;
  created_at: string;
}

export default function SettingsPage() {
  const [university, setUniversity] = useState<University | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/v1/university/members')
      .then((r) => r.json())
      .then((members) => {
        if (members.length > 0 && members[0].university_id) {
          fetch(`/api/v1/subjects?universityId=${members[0].university_id}`)
            .then((r) => r.json())
            .then(() => {
              setUniversity({
                id: members[0].university_id,
                name: 'Loading...',
                slug: '',
                created_at: '',
              });
              setLoading(false);
            });
        } else {
          setLoading(false);
        }
      })
      .catch(() => setLoading(false));
  }, []);

  return (
    <div className="space-y-6">
      <h2 className="text-2xl font-bold">Settings</h2>

      <Card>
        <CardHeader>
          <CardTitle>University Profile</CardTitle>
          <CardDescription>Your organization details</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {loading ? (
            <div className="space-y-3">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-4 w-32" />
            </div>
          ) : university ? (
            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium text-muted-foreground">Name</p>
                <p className="text-lg font-semibold">{university.name}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Slug</p>
                <div className="flex items-center gap-2">
                  <code className="bg-muted px-2 py-1 rounded text-sm">{university.slug}</code>
                  <Badge variant="outline">Read-only</Badge>
                </div>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">Created</p>
                <p className="text-sm">{new Date(university.created_at).toLocaleDateString()}</p>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground">No university assigned</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Subscription</CardTitle>
          <CardDescription>Current plan and billing info</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <Badge variant="default" className="text-sm px-3 py-1">
              Basic Plan
            </Badge>
            <span className="text-sm text-muted-foreground">Managed by system administrators</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
