'use client';

import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  StatCard,
} from '@studiq/ui';
import { ArrowRight, GraduationCap, Plus, UserCheck, Users } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useApiQuery } from '@/hooks/use-api';
import { useOrgs } from '@/hooks/use-orgs';
import { organizationKeys } from '@/lib/query-keys';

interface Member {
  id: string;
  email: string;
  full_name: string | null;
  orgRoleName: string;
  created_at: string;
}

export default function ManageOverviewPage() {
  const t = useTranslations('ManageOverviewPage');
  const { activeOrg } = useOrgs();

  // `/api/v1/organization/members` scopes itself from the `active_org_id`
  // cookie, so the cache entry is keyed by the active org: when the org
  // changes, React Query observes a new key and fetches with the new cookie.
  // `staleTime: 0` keeps the dashboard fresh when it remounts, as the previous
  // one-shot fetch did.
  const { data: members = [], isPending } = useApiQuery<Member[]>({
    queryKey: organizationKeys.members(activeOrg?.id),
    url: '/api/v1/organization/members',
    enabled: !!activeOrg?.id,
    staleTime: 0,
  });

  const loading = !activeOrg || isPending;

  const teachers = members.filter((m) => m.orgRoleName === 'teacher');
  const students = members.filter((m) => m.orgRoleName === 'member');
  const recentMembers = [...members]
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    .slice(0, 5);

  return (
    <div className="space-y-8">
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <StatCard
          title={t('total_members')}
          value={loading ? '...' : members.length}
          icon={Users}
        />
        <StatCard
          title={t('teachers')}
          value={loading ? '...' : teachers.length}
          icon={GraduationCap}
        />
        <StatCard
          title={t('students')}
          value={loading ? '...' : students.length}
          icon={UserCheck}
        />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('quick_actions')}</CardTitle>
            <CardDescription>{t('quick_actions_desc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Link href="/manage/invites">
              <Button variant="outline" className="w-full justify-between">
                <span className="flex items-center gap-2">
                  <Plus className="h-4 w-4" /> {t('invite_members')}
                </span>
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
            <Link href="/manage/members">
              <Button variant="outline" className="w-full justify-between">
                <span className="flex items-center gap-2">
                  <Users className="h-4 w-4" /> {t('manage_members')}
                </span>
                <ArrowRight className="h-4 w-4" />
              </Button>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('recent_members')}</CardTitle>
            <CardDescription>{t('recent_desc')}</CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <p className="text-center py-4 text-muted-foreground">{t('loading')}</p>
            ) : recentMembers.length > 0 ? (
              <div className="space-y-3">
                {recentMembers.map((m) => (
                  <div key={m.id} className="flex items-center justify-between">
                    <div>
                      <p className="text-sm font-medium">{m.full_name || m.email}</p>
                      {m.full_name && <p className="text-xs text-muted-foreground">{m.email}</p>}
                    </div>
                    <span className="text-sm text-muted-foreground">{m.orgRoleName}</span>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-center py-4 text-muted-foreground">{t('no_members')}</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
