'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { StatCard } from '@/components/ui/stat-card';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { RoleBadge } from '@/components/ui/role-badge';
import { Users, UserCheck, GraduationCap, ArrowRight, Plus } from 'lucide-react';
import { UserRole } from '@/types';

interface Member {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  created_at: string;
}

export default function ManageOverviewPage() {
  const t = useTranslations('ManageOverviewPage');
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/v1/university/members')
      .then((r) => r.json())
      .then((data) => {
        setMembers(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const teachers = members.filter((m) => m.role === UserRole.TEACHER);
  const students = members.filter((m) => m.role === UserRole.STUDENT);
  const admins = members.filter((m) => m.role === UserRole.UNIVERSITY_ADMIN);
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
        <StatCard title={t('admins')} value={loading ? '...' : admins.length} icon={Users} />
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('quick_actions')}</CardTitle>
            <CardDescription>{t('quick_actions_desc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            <Link href="/manage/invitations">
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
                    <RoleBadge role={m.role as UserRole} />
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
