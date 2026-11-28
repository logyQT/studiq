'use client';

import type { PlanInfo } from '@studiq/server/services/subscription-plan.service';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@studiq/ui';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2, Plus, Trash2, UserCheck } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useCallback, useState } from 'react';
import { toast } from 'sonner';
import { SeatPoolsTable } from '@/components/manage/seat-pools-table';
import { FOCUS_RING } from '@/components/shared/focus-ring';
import { useApiQuery } from '@/hooks/use-api';
import { useOrgScopedLoad } from '@/hooks/use-org-scoped-load';
import { useOrgs } from '@/hooks/use-orgs';
import { usePermission } from '@/hooks/use-permission';
import { ApiError, apiDelete, apiGet, apiPost } from '@/lib/api';
import { formatDate } from '@/lib/datetime';
import { formatPlanPrice } from '@/lib/landing-pricing';
import { formatLimitValue } from '@/lib/pricing-ladders';
import { invalidateAuthority } from '@/lib/query-cache';

interface Pool {
  id: string;
  planKey: string;
  total: number;
  assigned: number;
}

interface Member {
  id: string;
  email: string;
  full_name: string | null;
  orgRoleName: string;
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
 * The organization's seat licences (ADR-0015 §4.1). The tiers are read-only
 * here: the tier cards describe what a seat gives, and the purchase action
 * arrives with the pool checkout. Assignment and release write through the
 * existing `org.seat.manage` routes.
 */
export default function ManageSeatsPage() {
  const t = useTranslations('ManageSeatsPage');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const { activeOrg } = useOrgs();
  const permission = usePermission();
  // The write gate is `org.seat.manage` (ADR-0015 §4.1). `usePermission()` is a
  // provisional `false` until `/me/permissions` resolves, so a roster-only role
  // never sees a control the API would refuse.
  const canManageSeats = permission('org.seat.manage');
  const {
    data: licencePlans,
    isLoading: licencePlansLoading,
    isError: licencePlansError,
    refetch: refetchLicencePlans,
  } = useApiQuery<PlanInfo[]>({
    queryKey: ['subscription-plans', 'licence', activeOrg?.id],
    url: '/api/v1/organization/seats/licence-plans',
    enabled: !!activeOrg?.id,
  });
  const planName = (key: string) => licencePlans?.find((plan) => plan.key === key)?.name ?? key;
  const [pools, setPools] = useState<Pool[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedPoolId, setSelectedPoolId] = useState('');
  const [assigning, setAssigning] = useState(false);
  const [unassigning, setUnassigning] = useState<string | null>(null);
  const [seatsFull, setSeatsFull] = useState(false);

  const loadData = useCallback(() => {
    setLoading(true);
    Promise.all([
      apiGet<Pool[]>('/api/v1/organization/seats/pools'),
      apiGet<Assignment[]>('/api/v1/organization/seats/assignments'),
      apiGet<Member[]>('/api/v1/organization/members'),
    ])
      .then(([poolRows, assignmentRows, memberRows]) => {
        setPools(poolRows);
        setAssignments(assignmentRows);
        setMembers(memberRows);
        setLoading(false);
        return undefined;
      })
      .catch(() => setLoading(false));
  }, []);

  useOrgScopedLoad(loadData);

  const assignedUserIds = new Set(assignments.map((a) => a.userId));
  const unassignedMembers = members.filter((m) => !assignedUserIds.has(m.id));

  async function handleAssign() {
    if (!selectedUserId || !selectedPoolId) return;
    setAssigning(true);
    try {
      await apiPost('/api/v1/organization/seats/assignments', {
        userId: selectedUserId,
        poolId: selectedPoolId,
      });

      toast.success(t('assign_success'));
      setAssignDialogOpen(false);
      setSelectedUserId('');
      setSelectedPoolId('');
      loadData();
      // A seat changes this caller's effective entitlement set and the seat
      // pools; only this client's caches are dropped here. The seated member
      // sees their new set on the next refetch on focus (≤60 s).
      invalidateAuthority(queryClient);
    } catch (error) {
      if (error instanceof ApiError && error.code === 'USAGE_LIMIT_EXCEEDED') {
        // The refusal needs the tier cards, and the modal locks the page scroll,
        // so the alert lives on the page instead of inside the dialog.
        setAssignDialogOpen(false);
        setSeatsFull(true);
        return;
      }
      toast.error(t('assign_failed'));
    } finally {
      setAssigning(false);
    }
  }

  async function handleUnassign(assignmentId: string) {
    setUnassigning(assignmentId);
    try {
      await apiDelete(`/api/v1/organization/seats/assignments/${assignmentId}`);

      toast.success(t('unassign_success'));
      loadData();
      invalidateAuthority(queryClient);
    } catch {
      toast.error(t('unassign_failed'));
    } finally {
      setUnassigning(null);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('title')}</h1>
          <p className="text-muted-foreground">{t('description')}</p>
        </div>
        <Dialog
          open={assignDialogOpen}
          onOpenChange={(open) => {
            // Reset on open: Anuluj and the success path close the dialog without
            // going through onOpenChange, so resetting on close would be skipped.
            if (open) {
              setSelectedUserId('');
              setSelectedPoolId('');
              setSeatsFull(false);
            }
            setAssignDialogOpen(open);
          }}
        >
          {canManageSeats ? (
            <DialogTrigger asChild>
              <Button>
                <Plus className="size-4 mr-2" />
                {t('assign_seat')}
              </Button>
            </DialogTrigger>
          ) : null}
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('assign_dialog_title')}</DialogTitle>
              <DialogDescription>{t('assign_dialog_desc')}</DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <label id="seat-member-label" htmlFor="seat-member" className="text-sm font-medium">
                  {t('member_label')}
                </label>
                <Select
                  value={selectedUserId}
                  onValueChange={(v) => {
                    setSelectedUserId(v);
                    setSelectedPoolId('');
                    setSeatsFull(false);
                  }}
                >
                  <SelectTrigger id="seat-member" aria-labelledby="seat-member-label">
                    <SelectValue placeholder={t('member_placeholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    {unassignedMembers.map((m) => (
                      <SelectItem key={m.id} value={m.id}>
                        {m.full_name || m.email}
                        <span className="text-muted-foreground ml-2">({m.orgRoleName})</span>
                      </SelectItem>
                    ))}
                    {unassignedMembers.length === 0 && (
                      <SelectItem value="_none" disabled>
                        {t('no_unassigned')}
                      </SelectItem>
                    )}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <label id="seat-pool-label" htmlFor="seat-pool" className="text-sm font-medium">
                  {t('plan_label')}
                </label>
                <Select
                  value={selectedPoolId}
                  onValueChange={(v) => {
                    setSelectedPoolId(v);
                    setSeatsFull(false);
                  }}
                  disabled={!selectedUserId}
                >
                  <SelectTrigger id="seat-pool" aria-labelledby="seat-pool-label">
                    <SelectValue
                      placeholder={
                        selectedUserId ? t('plan_placeholder') : t('select_member_first')
                      }
                    />
                  </SelectTrigger>
                  <SelectContent>
                    {pools.map((p) => (
                      <SelectItem key={p.id} value={p.id}>
                        {planName(p.planKey)}
                        <span className="text-muted-foreground ml-2">
                          ({p.assigned}/{p.total})
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAssignDialogOpen(false)}>
                {t('cancel')}
              </Button>
              <Button
                onClick={handleAssign}
                disabled={!selectedUserId || !selectedPoolId || assigning}
              >
                {assigning && <Loader2 className="size-4 mr-2 animate-spin" />}
                {t('assign')}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>

      {seatsFull ? (
        <p
          role="alert"
          className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm font-medium text-destructive"
        >
          <a href="#licence-tiers" className="underline">
            {t('all_seats_assigned')}
          </a>
        </p>
      ) : null}

      <section id="licence-tiers" aria-labelledby="licence-tiers-title" className="space-y-4">
        <div>
          <h2 id="licence-tiers-title" className="text-lg font-semibold">
            {t('licence_tiers_title')}
          </h2>
          <p className="text-sm text-muted-foreground">{t('licence_tiers_desc')}</p>
          <p className="mt-2 text-sm text-muted-foreground">{t('ai_only_note')}</p>
        </div>
        {licencePlansLoading ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="size-6 animate-spin text-muted-foreground" aria-hidden="true" />
            <span className="sr-only">{t('licence_tiers_loading')}</span>
          </div>
        ) : licencePlansError ? (
          <div
            role="alert"
            className="flex flex-col items-start gap-3 rounded-lg border border-destructive/40 bg-destructive/5 p-4"
          >
            <p className="text-sm font-medium text-destructive">{t('licence_tiers_error')}</p>
            <Button variant="outline" size="sm" onClick={() => void refetchLicencePlans()}>
              {t('licence_tiers_retry')}
            </Button>
          </div>
        ) : (
          <ul className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {(licencePlans ?? []).map((plan) => (
              <li key={plan.key} className="rounded-lg border border-border p-4">
                <h3 className="font-semibold">{plan.name}</h3>
                <dl className="mt-3 space-y-2">
                  <div className="flex items-baseline justify-between gap-4">
                    <dt className="text-sm text-muted-foreground">{t('price_per_seat')}</dt>
                    <dd className="font-mono text-sm tabular-nums">
                      {formatPlanPrice(plan, locale)}
                    </dd>
                  </div>
                  {Object.entries(plan.limits).map(([limitKey, value]) => (
                    <div key={limitKey} className="flex items-baseline justify-between gap-4">
                      <dt className="text-sm text-muted-foreground">
                        {t.has(`quota_${limitKey}`) ? t(`quota_${limitKey}`) : limitKey}
                      </dt>
                      <dd className="font-mono text-sm tabular-nums">
                        {formatLimitValue(value, locale)}
                      </dd>
                    </div>
                  ))}
                </dl>
              </li>
            ))}
          </ul>
        )}
      </section>

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
                      {canManageSeats ? (
                        <TableHead scope="col" className="text-right">
                          {t('actions_column')}
                        </TableHead>
                      ) : null}
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
                        {canManageSeats ? (
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="icon"
                              aria-label={t('release_seat')}
                              onClick={() => handleUnassign(a.id)}
                              disabled={unassigning === a.id}
                            >
                              {unassigning === a.id ? (
                                <Loader2 className="size-4 animate-spin" />
                              ) : (
                                <Trash2 className="size-4 text-destructive" />
                              )}
                            </Button>
                          </TableCell>
                        ) : null}
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
