'use client';

import { useEffect, useState } from 'react';
import { ShieldCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

interface PermissionMatrix {
  roles: string[];
  resources: string[];
  actions: string[];
  matrix: Record<string, Record<string, Record<string, string>>>;
}

const SCOPE_STYLES: Record<string, string> = {
  any: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200',
  university: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200',
  own: 'bg-gray-100 text-gray-800 dark:bg-gray-800 dark:text-gray-200',
};

const SCOPE_LABELS: Record<string, string> = {
  any: 'any',
  university: 'university',
  own: 'own',
};

const ROLE_LABELS: Record<string, string> = {
  free: 'Free',
  premium: 'Premium',
  student: 'Student',
  teacher: 'Teacher',
  university_admin: 'Uni Admin',
  sys_admin: 'Sys Admin',
};

const ACTION_LABELS: Record<string, string> = {
  create: 'Create',
  read: 'Read',
  update: 'Update',
  delete: 'Delete',
};

export default function AdminPermissionsPage() {
  const t = useTranslations('AdminPermissionsPage');
  const [data, setData] = useState<PermissionMatrix | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/api/v1/admin/permissions')
      .then((res) => res.json())
      .then((json) => {
        if (json.success) setData(json.data);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        {t('loading')}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64 text-destructive">
        {t('error')}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground mt-2">{t('description')}</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5" />
            {t('matrix_title')}
          </CardTitle>
          <CardDescription>{t('matrix_description')}</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-32">{t('role_column')}</TableHead>
                <TableHead className="w-28">{t('resource_column')}</TableHead>
                {data.actions.map((action) => (
                  <TableHead key={action} className="text-center w-24">
                    {ACTION_LABELS[action] ?? action}
                  </TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.roles.map((role, ri) =>
                data.resources.map((resource, resi) => (
                  <TableRow
                    key={`${role}-${resource}`}
                    className={resi === 0 ? 'border-t-2 border-border' : ''}
                  >
                    {resi === 0 && (
                      <TableCell
                        className="font-semibold align-top"
                        rowSpan={data.resources.length}
                      >
                        {ROLE_LABELS[role] ?? role}
                      </TableCell>
                    )}
                    <TableCell className="font-medium text-muted-foreground">
                      {resource}
                    </TableCell>
                    {data.actions.map((action) => {
                      const scope = data.matrix[role]?.[resource]?.[action] ?? '—';
                      const isMissing = scope === '—';
                      return (
                        <TableCell key={action} className="text-center">
                          {isMissing ? (
                            <span className="text-muted-foreground text-xs">—</span>
                          ) : (
                            <Badge
                              variant="secondary"
                              className={`font-mono text-xs ${SCOPE_STYLES[scope] ?? ''}`}
                            >
                              {SCOPE_LABELS[scope] ?? scope}
                            </Badge>
                          )}
                        </TableCell>
                      );
                    })}
                  </TableRow>
                )),
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
