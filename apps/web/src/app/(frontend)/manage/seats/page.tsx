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
import { useApiQuery } from '@/hooks/use-api';
import { SeatPoolsTable } from '@/components/manage/seat-pools-table';
import { FOCUS_RING } from '@/components/shared/focus-ring';
import { useOrgScopedLoad } from '@/hooks/use-org-scoped-load';
import { ApiError, apiGet, apiPost } from '@/lib/api';
import { formatDate } from '@/lib/datetime';
import { invalidateAuthority } from '@/lib/query-cache';
import { purchasableSeatPlans } from '@/lib/seats';

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
  /** The persona the plan picker filters pools by (D33); from the roster API. */
  accountType: string;
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

/** Storage bound of `org_seat_pools.total` (Postgres int4) — mirrors seat.model.ts. */
const MAX_SEAT_POOL_TOTAL = 2_147_483_647;

export default function ManageSeatsPage() {
  const t = useTranslations('ManageSeatsPage');
  const locale = useLocale();
  const queryClient = useQueryClient();
  const { data: plans } = useApiQuery<PlanInfo[]>({
    queryKey: ['subscription-plans', 'active'],
    url: '/api/v1/subscription-plans',
  });
  const planName = (key: string) => plans?.find((p) => p.key === key)?.name ?? key;
  /** Seat-licence plans, in catalogue order (D33: `scope='personal'` + `seatEligible`). */
  const purchasablePlans = purchasableSeatPlans(plans ?? []);
  const [pools, setPools] = useState<Pool[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [purchaseDialogOpen, setPurchaseDialogOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedPoolId, setSelectedPoolId] = useState('');
  const [purchasePlanKey, setPurchasePlanKey] = useState('');
  const [purchaseQtyInput, setPurchaseQtyInput] = useState('1');
  const purchaseQty = purchaseQtyInput.trim() === '' ? NaN : Number(purchaseQtyInput);
  const existingPlanTotal = pools.find((p) => p.planKey === purchasePlanKey)?.total ?? 0;
  const maxPurchasable = MAX_SEAT_POOL_TOTAL - existingPlanTotal;
  const qtyValid =
    Number.isInteger(purchaseQty) && purchaseQty >= 1 && purchaseQty <= maxPurchasable;
  const qtyTooLarge = Number.isFinite(purchaseQty) && purchaseQty > maxPurchasable;
  const qtyInvalid = purchaseQtyInput.trim() !== '' && !qtyValid && !qtyTooLarge;
  const [assigning, setAssigning] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const [unassigning, setUnassigning] = useState<string | null>(null);

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
      toast.error(
        error instanceof ApiError && error.code === 'USAGE_LIMIT_EXCEEDED'
          ? t('pool_full')
          : t('assign_failed'),
      );
    } finally {
      setAssigning(false);
    }
  }

  async function handleUnassign(assignmentId: string) {
    setUnassigning(assignmentId);
    try {
      const res = await fetch(`/api/v1/organization/seats/assignments/${assignmentId}`, {
        method: 'DELETE',
      });

      if (!res.ok) {
        toast.error(t('unassign_failed'));
        return;
      }

      toast.success(t('unassign_success'));
      loadData();
      invalidateAuthority(queryClient);
    } catch {
      toast.error(t('unassign_failed'));
    } finally {
      setUnassigning(null);
    }
  }

  async function handlePurchase() {
    if (!purchasePlanKey || !qtyValid) return;
    setPurchasing(true);
    try {
      await apiPost('/api/v1/organization/seats/pools', {
        planKey: purchasePlanKey,
        quantity: purchaseQty,
      });

      toast.success(t('purchase_success'));
      setPurchaseDialogOpen(false);
      setPurchasePlanKey('');
      setPurchaseQtyInput('1');
      loadData();
      invalidateAuthority(queryClient);
    } catch (error) {
      toast.error(
        error instanceof ApiError && error.code === 'UNPROCESSABLE_ENTITY'
          ? t('quantity_too_large')
          : t('purchase_failed'),
      );
    } finally {
      setPurchasing(false);
    }
  }

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">{t('title')}</h1>
          <p className="text-muted-foreground">{t('description')}</p>
        </div>
        <div className="flex gap-2">
          <Dialog
            open={purchaseDialogOpen}
            onOpenChange={(open) => {
              // Reset on open: Anuluj and the success path close the dialog without
              // going through onOpenChange, so resetting on close would be skipped.
              if (open) {
                setPurchasePlanKey('');
                setPurchaseQtyInput('1');
              }
              setPurchaseDialogOpen(open);
            }}
          >
            <DialogTrigger asChild>
              <Button variant="outline">
                <Plus className="size-4 mr-2" />
                {t('purchase_seats')}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t('purchase_dialog_title')}</DialogTitle>
                <DialogDescription>{t('purchase_dialog_desc')}</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t('plan_label')}</label>
                  <Select value={purchasePlanKey} onValueChange={setPurchasePlanKey}>
                    <SelectTrigger>
                      <SelectValue placeholder={t('plan_placeholder')} />
                    </SelectTrigger>
                    <SelectContent>
                      {purchasablePlans.map((p) => (
                        <SelectItem key={p.key} value={p.key}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t('quantity_label')}</label>
                  <input
                    type="number"
                    min={1}
                    max={maxPurchasable}
                    step={1}
                    value={purchaseQtyInput}
                    onChange={(e) => setPurchaseQtyInput(e.target.value)}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                  {qtyTooLarge ? (
                    <p role="alert" className="text-xs font-medium text-destructive">
                      {t('quantity_too_large')}
                    </p>
                  ) : qtyInvalid ? (
                    <p role="alert" className="text-xs font-medium text-destructive">
                      {t('quantity_invalid')}
                    </p>
                  ) : null}
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setPurchaseDialogOpen(false)}>
                  {t('cancel')}
                </Button>
                <Button
                  onClick={handlePurchase}
                  disabled={!purchasePlanKey || !qtyValid || purchasing}
                >
                  {purchasing && <Loader2 className="size-4 mr-2 animate-spin" />}
                  {t('confirm_purchase')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog
            open={assignDialogOpen}
            onOpenChange={(open) => {
              // Reset on open: Anuluj and the success path close the dialog without
              // going through onOpenChange, so resetting on close would be skipped.
              if (open) {
                setSelectedUserId('');
                setSelectedPoolId('');
              }
              setAssignDialogOpen(open);
            }}
          >
            <DialogTrigger asChild>
              <Button>
                <Plus className="size-4 mr-2" />
                {t('assign_seat')}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t('assign_dialog_title')}</DialogTitle>
                <DialogDescription>{t('assign_dialog_desc')}</DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                <div className="space-y-2">
                  <label className="text-sm font-medium">{t('member_label')}</label>
                  <Select
                    value={selectedUserId}
                    onValueChange={(v) => {
                      setSelectedUserId(v);
                      setSelectedPoolId('');
                    }}
                  >
                    <SelectTrigger>
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
                  <label className="text-sm font-medium">{t('plan_label')}</label>
                  <Select
                    value={selectedPoolId}
                    onValueChange={setSelectedPoolId}
                    disabled={!selectedUserId}
                  >
                    <SelectTrigger>
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
                      <TableHead scope="col" className="text-right">
                        {t('actions_column')}
                      </TableHead>
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
