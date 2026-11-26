'use client';

import type { PlanInfo } from '@studiq/server/services/subscription-plan.service';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@studiq/ui';
import { Loader2, UserCheck } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';
import { SeatPoolsTable } from '@/components/manage/seat-pools-table';
import { FOCUS_RING } from '@/components/shared/focus-ring';
import { useApiQuery } from '@/hooks/use-api';
import { useOrgScopedLoad } from '@/hooks/use-org-scoped-load';
import { apiGet } from '@/lib/api';
import { formatDate } from '@/lib/datetime';

interface Pool {
  id: string;
  planKey: string;
  total: number;
  assigned: number;
}

interface Assignment {
  id: string;
  userId: string;
  poolId: string;
  planKey: string;
  userEmail: string;
  userFullName: string | null;
  assignedAt: string;
}

/**
 * Read-only seat view (#1493). The organization ladder is capacity only, so a
 * sold seat no longer has a feature to add; organization licences arrive in
 * #1511. The purchase, assign and release actions are hidden, and the pools and
 * assignments stay visible. The API routes keep their authority checks: they are
 * the data path #1511 builds on, not this page.
 */
export default function ManageSeatsPage() {
  const t = useTranslations('ManageSeatsPage');
  const locale = useLocale();
  const { data: plans } = useApiQuery<PlanInfo[]>({
    queryKey: ['subscription-plans', 'active'],
    url: '/api/v1/subscription-plans',
  });
  const planName = (key: string) => plans?.find((plan) => plan.key === key)?.name ?? key;
  const [pools, setPools] = useState<Pool[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);

  const loadData = useCallback(() => {
    setLoading(true);
    Promise.all([
      apiGet<Pool[]>('/api/v1/organization/seats/pools'),
      apiGet<Assignment[]>('/api/v1/organization/seats/assignments'),
    ])
      .then(([poolRows, assignmentRows]) => {
        setPools(poolRows);
        setAssignments(assignmentRows);
        setLoading(false);
        return undefined;
      })
      .catch(() => setLoading(false));
  }, []);

  useOrgScopedLoad(loadData);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold">{t('title')}</h1>
        <p className="text-muted-foreground">{t('description')}</p>
        <p className="mt-2 text-sm text-muted-foreground">{t('frozen_note')}</p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="size-8 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <>
          <Card>
            <CardHeader>
              <CardTitle>{t('pools_title')}</CardTitle>
              <CardDescription>{t('pools_desc')}</CardDescription>
            </CardHeader>
            <CardContent>
              {pools.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">{t('no_pools')}</p>
              ) : (
                <SeatPoolsTable
                  pools={pools.map((pool) => ({
                    ...pool,
                    planLabel: planName(pool.planKey),
                  }))}
                />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>{t('assignments_title')}</CardTitle>
              <CardDescription>{t('assignments_desc')}</CardDescription>
            </CardHeader>
            <CardContent>
              {assignments.length === 0 ? (
                <p className="text-sm text-muted-foreground py-4 text-center">
                  {t('no_assignments')}
                </p>
              ) : (
                <Table
                  aria-label={t('assignments_title')}
                  containerClassName={FOCUS_RING}
                  containerProps={{
                    tabIndex: 0,
                    role: 'region',
                    'aria-label': t('assignments_title'),
                  }}
                >
                  <TableHeader>
                    <TableRow>
                      <TableHead scope="col">{t('member_column')}</TableHead>
                      <TableHead scope="col">{t('plan_column')}</TableHead>
                      <TableHead scope="col">{t('assigned_since_column')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {assignments.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <UserCheck className="size-4 text-muted-foreground" />
                            <span>{a.userFullName || a.userEmail || a.userId}</span>
                          </div>
                        </TableCell>
                        <TableCell>{planName(a.planKey)}</TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {formatDate(a.assignedAt, locale)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
