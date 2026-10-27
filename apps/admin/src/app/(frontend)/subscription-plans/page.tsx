'use client';

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
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

const ACCOUNT_TYPES = ['student', 'educator', 'manager'] as const;

type SubscriptionPlan = {
  id: string;
  key: string;
  name: string;
  priceMonthly: number | null;
  priceYearly: number | null;
  isActive: boolean;
  sortOrder: number;
  forAccountType: string | null;
};

type FormData = {
  key: string;
  name: string;
  priceMonthly: string;
  priceYearly: string;
  isActive: boolean;
  sortOrder: string;
  forAccountType: string;
};

const EMPTY_FORM: FormData = {
  key: '',
  name: '',
  priceMonthly: '',
  priceYearly: '',
  isActive: true,
  sortOrder: '0',
  forAccountType: '',
};

function buildPayload(data: FormData) {
  return {
    key: data.key,
    name: data.name,
    isActive: data.isActive,
    priceMonthly: data.priceMonthly === '' ? undefined : Number(data.priceMonthly),
    priceYearly: data.priceYearly === '' ? undefined : Number(data.priceYearly),
    sortOrder: data.sortOrder === '' ? undefined : Number(data.sortOrder),
    forAccountType: data.forAccountType === '' ? null : data.forAccountType,
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

  function mapDeleteError(error: Error): string {
    if (error instanceof ApiError && error.code === 'CONFLICT') return t('delete_failed_in_use');
    return t('delete_failed', { code: error.message });
  }

  const createMutation = useMutation({
    mutationFn: (data: FormData) => apiPost('/subscription-plans', buildPayload(data)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.subscriptionPlans.all });
      setDialogOpen(false);
      setForm(EMPTY_FORM);
      setFormError(null);
    },
    onError: (error: Error) => setFormError(error.message),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: FormData & { id: string }) =>
      apiPut(`/subscription-plans/${id}`, buildPayload(data)),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.subscriptionPlans.all });
      setDialogOpen(false);
      setEditing(null);
      setForm(EMPTY_FORM);
      setFormError(null);
    },
    onError: (error: Error) => setFormError(error.message),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiDelete(`/subscription-plans/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.subscriptionPlans.all });
      setDeleteTarget(null);
      setDeleteError(null);
    },
    onError: (error: Error) => setDeleteError(mapDeleteError(error)),
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
      forAccountType: plan.forAccountType ?? '',
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

  function formatPrice(cents: number | null) {
    if (cents === null) return '—';
    return `${(cents / 100).toFixed(2)} zł`;
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
                  <TableHead>{t('col_account_type')}</TableHead>
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
                        {plan.forAccountType
                          ? t(`account_type_${plan.forAccountType}`)
                          : t('account_type_any')}
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
                        <TableCell colSpan={8} className="bg-muted/30 px-12 py-3">
                          <PlanDetails planKey={plan.key} />
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))}
                {plans.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
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
              <Label>{t('col_account_type')}</Label>
              <Select
                value={form.forAccountType || 'any'}
                onValueChange={(v) => setForm({ ...form, forAccountType: v === 'any' ? '' : v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="any">{t('account_type_any')}</SelectItem>
                  {ACCOUNT_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {t(`account_type_${type}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
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
    queryFn: () => apiGet<Array<{ id: string; feature_key: string }>>('/plan-features'),
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
                {f.feature_key}
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
