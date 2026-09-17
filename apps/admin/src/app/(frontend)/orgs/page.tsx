'use client';

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@studiq/ui';
import { useQuery } from '@tanstack/react-query';
import { FolderOpen, Shield, Users } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { apiGet } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

type Org = {
  id: string;
  name: string;
  created_at: string;
  member_count: number;
  group_count: number;
  role_count: number;
};

export default function OrgsPage() {
  const t = useTranslations('Orgs');

  const { data: orgs = [], isLoading } = useQuery({
    queryKey: queryKeys.organizations.all,
    queryFn: () => apiGet<Org[]>('/organizations'),
  });

  return (
    <div className="p-8 space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground mt-1">{t('description')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('list_title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-muted-foreground">{t('loading')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('col_name')}</TableHead>
                  <TableHead>{t('col_members')}</TableHead>
                  <TableHead>{t('col_groups')}</TableHead>
                  <TableHead>{t('col_roles')}</TableHead>
                  <TableHead>{t('col_created')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {orgs.map((org) => (
                  <TableRow key={org.id}>
                    <TableCell>
                      <Link
                        href={`/orgs/${org.id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {org.name}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1.5">
                        <Users className="h-3.5 w-3.5 text-muted-foreground" />
                        {org.member_count}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1.5">
                        <FolderOpen className="h-3.5 w-3.5 text-muted-foreground" />
                        {org.group_count}
                      </span>
                    </TableCell>
                    <TableCell>
                      <span className="flex items-center gap-1.5">
                        <Shield className="h-3.5 w-3.5 text-muted-foreground" />
                        {org.role_count}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {new Date(org.created_at).toLocaleDateString()}
                    </TableCell>
                  </TableRow>
                ))}
                {orgs.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                      {t('empty')}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
