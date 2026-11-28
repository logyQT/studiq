'use client';

import { PLAN_BILLING_MODES, PLAN_SCOPES, PLAN_VISIBILITIES, SALES_CHANNELS } from '@studiq/authz';
import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Checkbox,
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronDown, ChevronRight, Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ConfirmDialog } from '@/app/(frontend)/components/confirm-dialog';
import { QueryError } from '@/app/(frontend)/components/query-error';
import { ApiError, apiDelete, apiGet, apiPost, apiPut } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

type SubscriptionPlan = {
  id: string;
  key: string;
  name: string;
  priceMonthly: number | null;
  priceYearly: number | null;
  isActive: boolean;
  sortOrder: number;
  scope: string;
  visibility: string;
  billingMode: string;
  salesChannels: string[];
};

type FormData = {
  key: string;
  name: string;
  priceMonthly: string;
  priceYearly: string;
  isActive: boolean;
  sortOrder: string;
  scope: string;
  visibility: string;
  billingMode: string;
  salesChannels: string[];
};

const EMPTY_FORM: FormData = {
  key: '',
  name: '',
  priceMonthly: '',
  priceYearly: '',
  isActive: true,
  sortOrder: '0',
  scope: 'personal',
  visibility: 'public',
  billingMode: 'stripe',
  salesChannels: ['individual'],
};

function formatPrice(cents: number | null) {
  if (cents === null) return '—';
  return `${(cents / 100).toFixed(2)} zł`;
}

function buildPayload(data: FormData) {
  return {
    key: data.key,
    name: data.name,
    isActive: data.isActive,
    priceMonthly: data.priceMonthly === '' ? undefined : Number(data.priceMonthly),
    priceYearly: data.priceYearly === '' ? undefined : Number(data.priceYearly),
    sortOrder: data.sortOrder === '' ? undefined : Number(data.sortOrder),
    scope: data.scope,
    visibility: data.visibility,
    billingMode: data.billingMode,
    salesChannels: data.salesChannels,
  };
}

export default function SubscriptionPlansPage() {
  const t = useTranslations('SubscriptionPlans');
  const tc = useTranslations('Common');
  const queryClient = useQueryClient();

  const {
    data: plans = [],
    error,
    isLoading,
    isError,
  } = useQuery({
    queryKey: queryKeys.subscriptionPlans.all,
    queryFn: () => apiGet<SubscriptionPlan[]>('/subscription-plans'),
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<SubscriptionPlan | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<SubscriptionPlan | null>(null);
  const [expandedKey, setExpandedKey] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  function mapDeleteError(err: Error): string {
    if (err instanceof ApiError && err.code === 'CONFLICT') return t('delete_failed_in_use');
    return t('delete_failed', { code: err.message });
  }

  const createMutation = useMutation({
    mutationFn: (data: FormData) => apiPost('/subscription-plans', buildPayload(data)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.subscriptionPlans.all });
      setDialogOpen(false);
      setForm(EMPTY_FORM);
      setFormError(null);
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: FormData & { id: string }) =>
      apiPut(`/subscription-plans/${id}`, buildPayload(data)),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.subscriptionPlans.all });
      setDialogOpen(false);
      setEditing(null);
      setForm(EMPTY_FORM);
      setFormError(null);
    },
    onError: (err: Error) => setFormError(err.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiDelete(`/subscription-plans/${id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.subscriptionPlans.all });
      setDeleteTarget(null);
      setDeleteError(null);
    },
    onError: (err: Error) => setDeleteError(mapDeleteError(err)),
  });

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setFormError(null);
    setDeleteError(null);
    setDialogOpen(true);
  }

  function openEdit(plan: SubscriptionPlan) {
    setEditing(plan);
    setForm({
      key: plan.key,
      name: plan.name,
      priceMonthly: plan.priceMonthly?.toString() ?? '',
      priceYearly: plan.priceYearly?.toString() ?? '',
      isActive: plan.isActive,
      sortOrder: plan.sortOrder.toString(),
      scope: plan.scope,
      visibility: plan.visibility,
      billingMode: plan.billingMode,
      salesChannels: plan.salesChannels,
    });
    setFormError(null);
    setDeleteError(null);
    setDialogOpen(true);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (editing) {
      updateMutation.mutate({ ...form, id: editing.id });
    } else {
      createMutation.mutate(form);
    }
  }

  return (
    <div className="p-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">{t('title')}</h1>
        <Button onClick={openCreate}>
          <Plus className="h-4 w-4 mr-2" />
          {t('create')}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('list_title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {deleteError && (
            <p className="mb-4 rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {deleteError}
            </p>
          )}
          {isLoading ? (
            <p className="text-muted-foreground">{tc('loading')}</p>
          ) : isError ? (
            <QueryError error={error} />
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>{t('col_key')}</TableHead>
                  <TableHead>{t('col_name')}</TableHead>
                  <TableHead>{t('col_scope')}</TableHead>
                  <TableHead>{t('col_visibility')}</TableHead>
                  <TableHead>{t('col_billing_mode')}</TableHead>
                  <TableHead>{t('col_sales_channels')}</TableHead>
                  <TableHead>{t('col_monthly')}</TableHead>
                  <TableHead>{t('col_yearly')}</TableHead>
                  <TableHead>{t('col_active')}</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {plans.map((plan) => (
                  <>
                    <TableRow key={plan.id}>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => setExpandedKey(expandedKey === plan.key ? null : plan.key)}
                        >
                          {expandedKey === plan.key ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </Button>
                      </TableCell>
                      <TableCell className="font-mono text-sm">{plan.key}</TableCell>
                      <TableCell>{plan.name}</TableCell>
                      <TableCell className="text-muted-foreground">
                        {t(`scope_${plan.scope}`)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {t(`visibility_${plan.visibility}`)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {t(`billing_mode_${plan.billingMode}`)}
                      </TableCell>
                      <TableCell className="text-muted-foreground">
                        {plan.salesChannels.map((channel) => t(`channel_${channel}`)).join(', ')}
                      </TableCell>
                      <TableCell>{formatPrice(plan.priceMonthly)}</TableCell>
                      <TableCell>{formatPrice(plan.priceYearly)}</TableCell>
                      <TableCell>
                        <span
                          className={plan.isActive ? 'text-green-600' : 'text-muted-foreground'}
                        >
                          {plan.isActive ? t('active') : t('inactive')}
                        </span>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEdit(plan)}>
                            <Pencil className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(plan)}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                    {expandedKey === plan.key && (
                      <TableRow key={`${plan.id}-detail`}>
                        <TableCell colSpan={11} className="bg-muted/30 px-12 py-3">
                          <PlanDetails planKey={plan.key} />
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))}
                {plans.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center text-muted-foreground py-8">
                      {t('empty')}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{editing ? t('edit') : t('create')}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            {formError && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {formError}
              </p>
            )}
            <div className="space-y-2">
              <Label>{t('col_key')}</Label>
              <Input
                value={form.key}
                onChange={(e) => setForm({ ...form, key: e.target.value })}
                disabled={!!editing}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>{t('col_name')}</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>{t('col_scope')}</Label>
              <Select value={form.scope} onValueChange={(v) => setForm({ ...form, scope: v })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLAN_SCOPES.map((scope) => (
                    <SelectItem key={scope} value={scope}>
                      {t(`scope_${scope}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t('col_visibility')}</Label>
                <Select
                  value={form.visibility}
                  onValueChange={(v) => setForm({ ...form, visibility: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PLAN_VISIBILITIES.map((visibility) => (
                      <SelectItem key={visibility} value={visibility}>
                        {t(`visibility_${visibility}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>{t('col_billing_mode')}</Label>
                <Select
                  value={form.billingMode}
                  onValueChange={(v) => setForm({ ...form, billingMode: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PLAN_BILLING_MODES.map((mode) => (
                      <SelectItem key={mode} value={mode}>
                        {t(`billing_mode_${mode}`)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t('col_sales_channels')}</Label>
              <div className="flex gap-6">
                {SALES_CHANNELS.map((channel) => (
                  <label key={channel} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={form.salesChannels.includes(channel)}
                      onCheckedChange={(checked) =>
                        setForm({
                          ...form,
                          salesChannels:
                            checked === true
                              ? [...form.salesChannels, channel]
                              : form.salesChannels.filter((value) => value !== channel),
                        })
                      }
                    />
                    {t(`channel_${channel}`)}
                  </label>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{t('sales_channels_hint')}</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>{t('col_monthly')}</Label>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={form.priceMonthly}
                  onChange={(e) => setForm({ ...form, priceMonthly: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">{t('price_unit_hint')}</p>
              </div>
              <div className="space-y-2">
                <Label>{t('col_yearly')}</Label>
                <Input
                  type="number"
                  min={0}
                  step={1}
                  value={form.priceYearly}
                  onChange={(e) => setForm({ ...form, priceYearly: e.target.value })}
                />
                <p className="text-xs text-muted-foreground">{t('price_unit_hint')}</p>
              </div>
            </div>
            <div className="space-y-2">
              <Label>{t('col_display_order')}</Label>
              <Input
                type="number"
                step={1}
                value={form.sortOrder}
                onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
              />
            </div>
            {editing && <PlanAssignments planId={editing.id} planName={form.name} />}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setDialogOpen(false)}>
                {tc('cancel')}
              </Button>
              <Button type="submit" disabled={createMutation.isPending || updateMutation.isPending}>
                {tc('save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t('delete_title')}
        description={t('delete_desc', { name: deleteTarget?.name ?? '' })}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        confirmLabel={tc('delete')}
        destructive
      />
    </div>
  );
}

type PlanAssignment = { organizationId: string; name: string };
type OrgOption = { id: string; name: string };

/**
 * The organizations an unlisted plan is pinned to (B3). Editing needs an
 * existing plan, so the dialog renders this only in edit mode. Removal is
 * refused while the organization is on the plan (409), and the copy says so
 * instead of reporting a generic failure.
 */
function PlanAssignments({ planId, planName }: { planId: string; planName: string }) {
  const t = useTranslations('SubscriptionPlans');
  const tc = useTranslations('Common');
  const queryClient = useQueryClient();
  const [selectedOrgId, setSelectedOrgId] = useState('');
  const [removeTarget, setRemoveTarget] = useState<PlanAssignment | null>(null);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [assignError, setAssignError] = useState<string | null>(null);

  const assignmentsQuery = useQuery({
    queryKey: queryKeys.planAssignments.byPlan(planId),
    queryFn: () => apiGet<PlanAssignment[]>(`/subscription-plans/${planId}/assignments`),
  });
  const orgsQuery = useQuery({
    queryKey: queryKeys.organizations.all,
    queryFn: () => apiGet<OrgOption[]>('/organizations'),
  });

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: queryKeys.planAssignments.byPlan(planId) });
  }

  const assignMutation = useMutation({
    mutationFn: (organizationId: string) =>
      apiPost(`/subscription-plans/${planId}/assignments`, { organizationId }),
    onSuccess: () => {
      invalidate();
      setSelectedOrgId('');
      setAssignError(null);
    },
    onError: (err: Error) =>
      setAssignError(
        err instanceof ApiError && err.code === 'BAD_REQUEST'
          ? t('assignment_error_scope')
          : t('assignment_add_failed', { code: err.message }),
      ),
  });

  const removeMutation = useMutation({
    mutationFn: (organizationId: string) =>
      apiDelete(`/subscription-plans/${planId}/assignments/${organizationId}`),
    onSuccess: () => {
      invalidate();
      setRemoveTarget(null);
      setRemoveError(null);
    },
    onError: (err: Error) =>
      setRemoveError(
        err instanceof ApiError && err.code === 'CONFLICT'
          ? t('assignment_remove_conflict')
          : t('assignment_remove_failed', { code: err.message }),
      ),
  });

  const assigned = assignmentsQuery.data ?? [];
  const assignedIds = new Set(assigned.map((assignment) => assignment.organizationId));
  const candidates = (orgsQuery.data ?? []).filter((org) => !assignedIds.has(org.id));
  // A Radix Select has no empty value, so the picker keeps a valid candidate
  // selected and falls back to the first one when the chosen org is assigned.
  const pickable = candidates.some((org) => org.id === selectedOrgId)
    ? selectedOrgId
    : candidates[0]?.id;

  return (
    <div className="space-y-3 rounded-md border border-border p-3">
      <div className="space-y-1">
        <p className="text-sm font-medium">{t('assignments_title')}</p>
        <p className="text-xs text-muted-foreground">{t('assignments_hint')}</p>
      </div>

      {assignmentsQuery.isError ? (
        <QueryError error={assignmentsQuery.error} />
      ) : assigned.length === 0 ? (
        <p className="text-sm text-muted-foreground">{t('assignments_empty')}</p>
      ) : (
        <ul className="space-y-1">
          {assigned.map((assignment) => (
            <li
              key={assignment.organizationId}
              className="flex items-center justify-between gap-2 text-sm"
            >
              <span>{assignment.name}</span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => {
                  setRemoveTarget(assignment);
                  setRemoveError(null);
                }}
              >
                <Trash2 className="h-4 w-4 text-destructive" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {removeError && <p className="text-sm text-destructive">{removeError}</p>}

      {candidates.length > 0 ? (
        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-2">
            <Label>{t('assignment_select')}</Label>
            <Select value={pickable} onValueChange={setSelectedOrgId}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {candidates.map((org) => (
                  <SelectItem key={org.id} value={org.id}>
                    {org.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            type="button"
            variant="outline"
            disabled={assignMutation.isPending || !pickable}
            onClick={() => pickable && assignMutation.mutate(pickable)}
          >
            {t('assignment_add')}
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">{t('assignment_no_candidates')}</p>
      )}

      {assignError && <p className="text-sm text-destructive">{assignError}</p>}

      <ConfirmDialog
        open={!!removeTarget}
        onOpenChange={(open) => !open && setRemoveTarget(null)}
        title={t('assignment_remove_title')}
        description={t('assignment_remove_desc', {
          name: removeTarget?.name ?? '',
          plan: planName,
        })}
        onConfirm={() => removeTarget && removeMutation.mutate(removeTarget.organizationId)}
        confirmLabel={tc('delete')}
        destructive
      />
    </div>
  );
}

function PlanDetails({ planKey }: { planKey: string }) {
  const t = useTranslations('SubscriptionPlans');

  const { data: limits = [], error: limitsError } = useQuery({
    queryKey: queryKeys.planLimits.byPlan(planKey),
    queryFn: () =>
      apiGet<Array<{ id: string; limit_key: string; limit_value: number }>>(
        `/plan-limits?planKey=${planKey}`,
      ),
  });

  const { data: features = [], error: featuresError } = useQuery({
    queryKey: [...queryKeys.planFeatures.all, planKey],
    queryFn: () => apiGet<Array<{ id: string; entitlement_key: string }>>('/plan-features'),
  });

  const planFeatures = features.filter((f) => (f as Record<string, unknown>).plan_key === planKey);

  if (limitsError || featuresError) {
    return <QueryError error={limitsError ?? featuresError} />;
  }

  if (limits.length === 0 && planFeatures.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('no_features')}</p>;
  }

  return (
    <div className="space-y-3">
      {planFeatures.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">{t('features_label')}</p>
          <div className="flex flex-wrap gap-1">
            {planFeatures.map((f) => (
              <span
                key={f.id}
                className="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
              >
                {f.entitlement_key}
              </span>
            ))}
          </div>
        </div>
      )}
      {limits.length > 0 && (
        <div>
          <p className="text-xs font-medium text-muted-foreground mb-1">{t('limits_label')}</p>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="text-xs">{t('limit_key')}</TableHead>
                <TableHead className="text-xs">{t('limit_value')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {limits.map((l) => (
                <TableRow key={l.id}>
                  <TableCell className="font-mono text-xs py-1">{l.limit_key}</TableCell>
                  <TableCell className="py-1">{l.limit_value}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
