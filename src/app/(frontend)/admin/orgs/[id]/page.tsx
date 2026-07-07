'use client';

import { ArrowLeft, Layers, Loader2, Shield, Users } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { OrgAvatar } from '@/components/ui/org-avatar';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface OrgDetail {
  id: string;
  name: string;
  plan: string;
  created_at: string;
  members: {
    id: string;
    full_name: string | null;
    email: string;
    role_name: string;
    joined_at: string;
  }[];
  groups: {
    id: string;
    name: string;
    member_count: number;
    teacher_count: number;
  }[];
  roles: {
    id: string;
    name: string;
    description: string | null;
    is_system: boolean;
    permission_count: number;
  }[];
}

export default function AdminOrgDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const t = useTranslations('AdminOrgDetailPage');
  const [org, setOrg] = useState<OrgDetail | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const { id } = await params;
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/admin/organizations/${id}/details`);
      const json = await res.json();
      if (json.success) setOrg(json.data);
    } catch {
      // handled by empty state
    } finally {
      setLoading(false);
    }
  }, [params]);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!org) {
    return (
      <div className="space-y-6">
        <Button variant="ghost" asChild className="-ml-2">
          <Link href="/admin/orgs">
            <ArrowLeft className="w-4 h-4 mr-2" />
            {t('back')}
          </Link>
        </Button>
        <p className="text-muted-foreground text-center py-20">{t('not_found')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Button variant="ghost" asChild className="-ml-2">
        <Link href="/admin/orgs">
          <ArrowLeft className="w-4 h-4 mr-2" />
          {t('back')}
        </Link>
      </Button>

      {/* Overview */}
      <Card>
        <CardHeader className="flex flex-row items-center gap-4">
          <OrgAvatar orgId={org.id} name={org.name} size={48} />
          <div>
            <CardTitle className="text-2xl">{org.name}</CardTitle>
            <CardDescription className="flex items-center gap-2 mt-1">
              <Badge variant="secondary" className="capitalize">
                {org.plan}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {t('created', { date: new Date(org.created_at).toLocaleDateString() })}
              </span>
            </CardDescription>
          </div>
        </CardHeader>
      </Card>

      {/* Summary cards */}
      <div className="grid md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center gap-3 pb-2">
            <Users className="w-5 h-5 text-muted-foreground" />
            <div>
              <CardTitle className="text-sm font-medium">{t('members_title')}</CardTitle>
              <CardDescription className="text-2xl font-bold mt-1">
                {org.members.length}
              </CardDescription>
            </div>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center gap-3 pb-2">
            <Layers className="w-5 h-5 text-muted-foreground" />
            <div>
              <CardTitle className="text-sm font-medium">{t('groups_title')}</CardTitle>
              <CardDescription className="text-2xl font-bold mt-1">
                {org.groups.length}
              </CardDescription>
            </div>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center gap-3 pb-2">
            <Shield className="w-5 h-5 text-muted-foreground" />
            <div>
              <CardTitle className="text-sm font-medium">{t('roles_title')}</CardTitle>
              <CardDescription className="text-2xl font-bold mt-1">
                {org.roles.length}
              </CardDescription>
            </div>
          </CardHeader>
        </Card>
      </div>

      {/* Members */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t('members_title')}</CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('member_name')}</TableHead>
                <TableHead>{t('member_email')}</TableHead>
                <TableHead>{t('member_role')}</TableHead>
                <TableHead>{t('member_joined')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {org.members.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                    {t('members_empty')}
                  </TableCell>
                </TableRow>
              )}
              {org.members.map((m) => (
                <TableRow key={m.id}>
                  <TableCell className="font-medium">{m.full_name ?? '—'}</TableCell>
                  <TableCell className="text-muted-foreground">{m.email}</TableCell>
                  <TableCell>
                    <Badge variant="outline">{m.role_name}</Badge>
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {new Date(m.joined_at).toLocaleDateString()}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Groups */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t('groups_title')}</CardTitle>
          <CardDescription>{t('groups_desc')}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('group_name')}</TableHead>
                <TableHead className="text-center">{t('group_members')}</TableHead>
                <TableHead className="text-center">{t('group_teachers')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {org.groups.length === 0 && (
                <TableRow>
                  <TableCell colSpan={3} className="text-center py-8 text-muted-foreground">
                    {t('groups_empty')}
                  </TableCell>
                </TableRow>
              )}
              {org.groups.map((g) => (
                <TableRow key={g.id}>
                  <TableCell className="font-medium">{g.name}</TableCell>
                  <TableCell className="text-center">{g.member_count}</TableCell>
                  <TableCell className="text-center">{g.teacher_count}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {/* Roles */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">{t('roles_title')}</CardTitle>
          <CardDescription>{t('roles_desc')}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('role_name')}</TableHead>
                <TableHead>{t('role_description')}</TableHead>
                <TableHead className="text-center">{t('role_permissions')}</TableHead>
                <TableHead>{t('role_system')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {org.roles.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                    {t('roles_empty')}
                  </TableCell>
                </TableRow>
              )}
              {org.roles.map((r) => (
                <TableRow key={r.id}>
                  <TableCell className="font-medium capitalize">{r.name}</TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {r.description ?? '—'}
                  </TableCell>
                  <TableCell className="text-center">{r.permission_count}</TableCell>
                  <TableCell>
                    {r.is_system ? (
                      <Badge variant="secondary" className="text-xs">
                        {t('system_role')}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
