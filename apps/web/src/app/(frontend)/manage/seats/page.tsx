'use client';

import {
  Badge,
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
import { Loader2, Plus, Trash2, UserCheck } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

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

const PLAN_LABELS: Record<string, string> = {
  launch: 'StudiQ Launch',
  team: 'StudiQ Team',
  hub: 'StudiQ Hub',
  pro: 'StudiQ Pro',
  master: 'StudiQ Master',
  campus: 'StudiQ Campus',
};

/** Maps plan_key → compatible account tier (matches seat.service.ts PLAN_TIER_MAP). */
const PLAN_TIER_MAP: Record<string, string> = {
  base: 'student',
  spark: 'student',
  ace: 'student',
  pro: 'student',
  lite: 'educator',
  guide: 'educator',
  creator: 'educator',
  master: 'educator',
  launch: 'manager',
  team: 'manager',
  hub: 'manager',
  campus: 'manager',
};

/** Maps org role name → compatible account tier. */
const ROLE_TIER_MAP: Record<string, string> = {
  admin: 'manager',
  teacher: 'educator',
  member: 'student',
};

/** Plans available for purchase as seat add-ons. */
const PURCHASABLE_PLANS: { key: string; label: string; tier: string }[] = [
  { key: 'ace', label: 'StudiQ Ace', tier: 'student' },
  { key: 'pro', label: 'StudiQ Pro', tier: 'student' },
  { key: 'creator', label: 'StudiQ Creator', tier: 'educator' },
  { key: 'master', label: 'StudiQ Master', tier: 'educator' },
  { key: 'campus', label: 'StudiQ Campus', tier: 'manager' },
];

export default function ManageSeatsPage() {
  const t = useTranslations('ManageSeatsPage');
  const [pools, setPools] = useState<Pool[]>([]);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [purchaseDialogOpen, setPurchaseDialogOpen] = useState(false);
  const [selectedUserId, setSelectedUserId] = useState('');
  const [selectedPoolId, setSelectedPoolId] = useState('');
  const [purchasePlanKey, setPurchasePlanKey] = useState('');
  const [purchaseQty, setPurchaseQty] = useState(1);
  const [assigning, setAssigning] = useState(false);
  const [purchasing, setPurchasing] = useState(false);
  const [unassigning, setUnassigning] = useState<string | null>(null);

  const loadData = useCallback(() => {
    setLoading(true);
    Promise.all([
      fetch('/api/v1/organization/seats/pools').then((r) => r.json()),
      fetch('/api/v1/organization/seats/assignments').then((r) => r.json()),
      fetch('/api/v1/organization/members').then((r) => r.json()),
    ])
      .then(([poolsRes, assignmentsRes, membersRes]) => {
        if (poolsRes.success) setPools(poolsRes.data);
        if (assignmentsRes.success) setAssignments(assignmentsRes.data);
        if (membersRes.success) setMembers(membersRes.data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const assignedUserIds = new Set(assignments.map((a) => a.userId));
  const unassignedMembers = members.filter((m) => !assignedUserIds.has(m.id));

  async function handleAssign() {
    if (!selectedUserId || !selectedPoolId) return;
    setAssigning(true);
    try {
      const res = await fetch('/api/v1/organization/seats/assignments', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: selectedUserId, poolId: selectedPoolId }),
      });

      const data = await res.json();
      if (!data.success) {
        toast.error(data.error === 'USAGE_LIMIT_EXCEEDED' ? t('pool_full') : t('assign_failed'));
        return;
      }

      toast.success(t('assign_success'));
      setAssignDialogOpen(false);
      setSelectedUserId('');
      setSelectedPoolId('');
      loadData();
    } catch {
      toast.error(t('assign_failed'));
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
    } catch {
      toast.error(t('unassign_failed'));
    } finally {
      setUnassigning(null);
    }
  }

  async function handlePurchase() {
    if (!purchasePlanKey || purchaseQty < 1) return;
    setPurchasing(true);
    try {
      const res = await fetch('/api/v1/organization/seats/pools', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planKey: purchasePlanKey, quantity: purchaseQty }),
      });

      const data = await res.json();
      if (!data.success) {
        toast.error(t('purchase_failed'));
        return;
      }

      toast.success(t('purchase_success'));
      setPurchaseDialogOpen(false);
      setPurchasePlanKey('');
      setPurchaseQty(1);
      loadData();
    } catch {
      toast.error(t('purchase_failed'));
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
          <Dialog open={purchaseDialogOpen} onOpenChange={setPurchaseDialogOpen}>
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
                      {PURCHASABLE_PLANS.map((p) => (
                        <SelectItem key={p.key} value={p.key}>
                          {p.label}
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
                    value={purchaseQty}
                    onChange={(e) => setPurchaseQty(Math.max(1, Number(e.target.value)))}
                    className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setPurchaseDialogOpen(false)}>
                  {t('cancel')}
                </Button>
                <Button
                  onClick={handlePurchase}
                  disabled={!purchasePlanKey || purchaseQty < 1 || purchasing}
                >
                  {purchasing && <Loader2 className="size-4 mr-2 animate-spin" />}
                  {t('confirm_purchase')}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
          <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
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
                      {(() => {
                        const selectedMember = members.find((m) => m.id === selectedUserId);
                        const memberTier = selectedMember
                          ? ROLE_TIER_MAP[selectedMember.orgRoleName]
                          : undefined;
                        const compatible = memberTier
                          ? pools.filter((p) => PLAN_TIER_MAP[p.planKey] === memberTier)
                          : pools;
                        return compatible.map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {PLAN_LABELS[p.planKey] || p.planKey}
                            <span className="text-muted-foreground ml-2">
                              ({p.assigned}/{p.total})
                            </span>
                          </SelectItem>
                        ));
                      })()}
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
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('plan_column')}</TableHead>
                      <TableHead className="text-right">{t('purchased_column')}</TableHead>
                      <TableHead className="text-right">{t('assigned_column')}</TableHead>
                      <TableHead className="text-right">{t('available_column')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pools.map((pool) => {
                      const available = pool.total - pool.assigned;
                      const nearFull =
                        pool.total > 0 && available <= Math.max(1, Math.floor(pool.total * 0.2));

                      return (
                        <TableRow key={pool.id}>
                          <TableCell className="font-medium">
                            {PLAN_LABELS[pool.planKey] || pool.planKey}
                          </TableCell>
                          <TableCell className="text-right">{pool.total}</TableCell>
                          <TableCell className="text-right">{pool.assigned}</TableCell>
                          <TableCell className="text-right">
                            <span className={nearFull ? 'text-destructive font-medium' : ''}>
                              {available}
                            </span>
                            {nearFull && (
                              <Badge variant="destructive" className="ml-2">
                                {t('low')}
                              </Badge>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
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
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('member_column')}</TableHead>
                      <TableHead>{t('plan_column')}</TableHead>
                      <TableHead>{t('assigned_since_column')}</TableHead>
                      <TableHead className="text-right">{t('actions_column')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {assignments.map((a) => (
                      <TableRow key={a.id}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <UserCheck className="size-4 text-muted-foreground" />
                            <span>{a.userFullName || a.userEmail}</span>
                          </div>
                        </TableCell>
                        <TableCell>{PLAN_LABELS[a.planKey] || a.planKey}</TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {new Date(a.assignedAt).toLocaleDateString()}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant="ghost"
                            size="icon"
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
