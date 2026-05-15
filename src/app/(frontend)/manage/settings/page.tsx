'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
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
  const t = useTranslations('ManageSettingsPage');
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
      <h2 className="text-2xl font-bold">{t('title')}</h2>

      <Card>
        <CardHeader>
          <CardTitle>{t('university_profile_title')}</CardTitle>
          <CardDescription>{t('university_profile_desc')}</CardDescription>
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
                <p className="text-sm font-medium text-muted-foreground">{t('name_label')}</p>
                <p className="text-lg font-semibold">{university.name}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">{t('slug_label')}</p>
                <div className="flex items-center gap-2">
                  <code className="bg-muted px-2 py-1 rounded text-sm">{university.slug}</code>
                  <Badge variant="outline">{t('read_only')}</Badge>
                </div>
              </div>
              <div>
                <p className="text-sm font-medium text-muted-foreground">{t('created_label')}</p>
                <p className="text-sm">{new Date(university.created_at).toLocaleDateString()}</p>
              </div>
            </div>
          ) : (
            <p className="text-muted-foreground">{t('no_university')}</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('subscription_title')}</CardTitle>
          <CardDescription>{t('subscription_desc')}</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <Badge variant="default" className="text-sm px-3 py-1">
              {t('basic_plan')}
            </Badge>
            <span className="text-sm text-muted-foreground">{t('managed_by_admins')}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
