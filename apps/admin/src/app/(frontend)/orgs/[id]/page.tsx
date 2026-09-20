'use client';

import {
  Badge,
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Separator,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@studiq/ui';
import { useQuery } from '@tanstack/react-query';
import { ArrowLeft, FolderOpen, Shield, Users } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { use } from 'react';
import { apiGet } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

type OrgDetail = {
  id: string;
  name: string;
  created_at: string;
  members: Array<{
    id: string;
    full_name: string | null;
    email: string;
    role_name: string;
    joined_at: string;
  }>;
  groups: Array<{
    id: string;
    name: string;
    member_count: number;
    teacher_count: number;
  }>;
  roles: Array<{
    id: string;
    name: string;
    description: string | null;
    is_system: boolean;
    permission_count: number;
  }>;
};

export default function OrgDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const t = useTranslations('OrgDetail');

  const { data: org, isLoading } = useQuery({
    queryKey: queryKeys.organizations.detail(id),
    queryFn: () => apiGet<OrgDetail>(`/organizations/${id}`),
  });

  if (isLoading) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">{t('loading')}</p>
      </div>
    );
  }

  if (!org) {
    return (
      <div className="p-8">
        <p className="text-muted-foreground">{t('not_found')}</p>
      </div>
    );
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" asChild>
          <Link href="/orgs">
            <ArrowLeft className="h-4 w-4" />
          </Link>
        </Button>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{org.name}</h1>
          <p className="text-sm text-muted-foreground">
            {t('created')} {new Date(org.created_at).toLocaleDateString()}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <Users className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium">{t('members')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{org.members.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <FolderOpen className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium">{t('groups')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{org.groups.length}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex flex-row items-center gap-2 pb-2">
            <Shield className="h-4 w-4 text-muted-foreground" />
            <CardTitle className="text-sm font-medium">{t('roles')}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-2xl font-bold">{org.roles.length}</p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="members">
        <TabsList>
          <TabsTrigger value="members">{t('tab_members')}</TabsTrigger>
          <TabsTrigger value="groups">{t('tab_groups')}</TabsTrigger>
          <TabsTrigger value="roles">{t('tab_roles')}</TabsTrigger>
        </TabsList>

        <TabsContent value="members">
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('col_name')}</TableHead>
                    <TableHead>{t('col_email')}</TableHead>
                    <TableHead>{t('col_role')}</TableHead>
                    <TableHead>{t('col_joined')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {org.members.map((m) => (
                    <TableRow key={m.id}>
                      <TableCell className="font-medium">{m.full_name ?? '—'}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">{m.email}</TableCell>
                      <TableCell>
                        <Badge variant="secondary">{m.role_name}</Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {new Date(m.joined_at).toLocaleDateString()}
                      </TableCell>
                    </TableRow>
                  ))}
                  {org.members.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                        {t('no_members')}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="groups">
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('col_group_name')}</TableHead>
                    <TableHead>{t('col_members')}</TableHead>
                    <TableHead>{t('col_teachers')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {org.groups.map((g) => (
                    <TableRow key={g.id}>
                      <TableCell className="font-medium">{g.name}</TableCell>
                      <TableCell>{g.member_count}</TableCell>
                      <TableCell>{g.teacher_count}</TableCell>
                    </TableRow>
                  ))}
                  {org.groups.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center text-muted-foreground py-8">
                        {t('no_groups')}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="roles">
          <Card>
            <CardContent className="pt-6">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('col_role_name')}</TableHead>
                    <TableHead>{t('col_description')}</TableHead>
                    <TableHead>{t('col_system')}</TableHead>
                    <TableHead>{t('col_permissions')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {org.roles.map((r) => (
                    <TableRow key={r.id}>
                      <TableCell className="font-medium">{r.name}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {r.description ?? '—'}
                      </TableCell>
                      <TableCell>
                        {r.is_system ? (
                          <Badge variant="secondary">{t('system')}</Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </TableCell>
                      <TableCell>{r.permission_count}</TableCell>
                    </TableRow>
                  ))}
                  {org.roles.length === 0 && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground py-8">
                        {t('no_roles')}
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
