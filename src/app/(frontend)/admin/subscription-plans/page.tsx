'use client';

import { CreditCard, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import type { PlanInfo } from '@/server/services/subscription-plan.service';

interface PlanFeature {
  id: string;
  plan_key: string;
  feature_key: string;
}

interface PlanLimit {
  id: string;
  plan_key: string;
  limit_key: string;
  limit_value: number;
}

export default function AdminSubscriptionPlansPage() {
  const t = useTranslations('AdminSubscriptionPlansPage');
  const [plans, setPlans] = useState<PlanInfo[] | null>(null);
  const [allFeatures, setAllFeatures] = useState<{ key: string; name: string }[]>([]);
  const [planFeatures, setPlanFeatures] = useState<PlanFeature[]>([]);
  const [planLimits, setPlanLimits] = useState<PlanLimit[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<PlanInfo | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<PlanInfo | null>(null);
  const [addingFeature, setAddingFeature] = useState<string | null>(null);
  const [addingLimit, setAddingLimit] = useState<{ planKey: string; limitKey: string } | null>(
    null,
  );
  // editingLimit state available if inline limit editing is needed later

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [plansRes, featuresRes, pfRes, plRes] = await Promise.all([
        fetch('/api/v1/admin/subscription-plans'),
        fetch('/api/v1/admin/feature-flags'),
        fetch('/api/v1/admin/plan-features'),
        fetch('/api/v1/admin/plan-limits'),
      ]);
      const plansJson = await plansRes.json();
      const featuresJson = await featuresRes.json();
      const pfJson = await pfRes.json();
      const plJson = await plRes.json();
      if (plansJson.success) setPlans(plansJson.data);
      if (featuresJson.success) setAllFeatures(featuresJson.data);
      if (pfJson.success) setPlanFeatures(pfJson.data);
      if (plJson.success) setPlanLimits(plJson.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  function _getPlanFeatureIds(planKey: string): string[] {
    return planFeatures.filter((pf) => pf.plan_key === planKey).map((pf) => pf.id);
  }

  function getPlanFeatureKeys(planKey: string): string[] {
    return planFeatures.filter((pf) => pf.plan_key === planKey).map((pf) => pf.feature_key);
  }

  function getPlanLimitsList(planKey: string): PlanLimit[] {
    return planLimits.filter((pl) => pl.plan_key === planKey);
  }

  async function handleSave(plan: Record<string, unknown>) {
    const url = plan.id
      ? `/api/v1/admin/subscription-plans/${plan.id}`
      : '/api/v1/admin/subscription-plans';
    const method = plan.id ? 'PUT' : 'POST';

    const body: Record<string, unknown> = {};
    if (plan.key !== undefined) body.key = plan.key;
    if (plan.name !== undefined) body.name = plan.name;
    if (plan.priceMonthly !== undefined) body.priceMonthly = plan.priceMonthly;

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(plan.id ? t('saved') : t('created'));
        setEditing(null);
        setCreating(false);
        load();
      } else {
        toast.error(t('failed'));
      }
    } catch {
      toast.error(t('failed'));
    }
  }

  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/v1/admin/subscription-plans/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        toast.success(t('deleted'));
        setDeleting(null);
        load();
      } else {
        toast.error(t('failed'));
      }
    } catch {
      toast.error(t('failed'));
    }
  }

  async function addFeatureToPlan(planKey: string, featureKey: string) {
    try {
      const res = await fetch('/api/v1/admin/plan-features', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planKey, featureKey }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(t('feature_added'));
        setAddingFeature(null);
        load();
      } else {
        toast.error(t('feature_failed'));
      }
    } catch {
      toast.error(t('feature_failed'));
    }
  }

  async function removeFeatureFromPlan(pfId: string) {
    try {
      const res = await fetch(`/api/v1/admin/plan-features/${pfId}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        toast.success(t('feature_removed'));
        load();
      } else {
        toast.error(t('feature_failed'));
      }
    } catch {
      toast.error(t('feature_failed'));
    }
  }

  async function addLimitToPlan(planKey: string, limitKey: string, limitValue: number) {
    try {
      const res = await fetch('/api/v1/admin/plan-limits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planKey, limitKey, limitValue }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success('Limit added');
        setAddingLimit(null);
        load();
      } else {
        toast.error('Failed to add limit');
      }
    } catch {
      toast.error('Failed to add limit');
    }
  }

  async function updateLimit(id: string, limitValue: number) {
    try {
      const res = await fetch(`/api/v1/admin/plan-limits/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ limitValue }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success('Limit updated');
        load();
      } else {
        toast.error('Failed to update limit');
      }
    } catch {
      toast.error('Failed to update limit');
    }
  }

  async function deleteLimit(id: string) {
    try {
      const res = await fetch(`/api/v1/admin/plan-limits/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        toast.success('Limit removed');
        load();
      } else {
        toast.error('Failed to remove limit');
      }
    } catch {
      toast.error('Failed to remove limit');
    }
  }

  const allLimitKeys = [...new Set(planLimits.map((pl) => pl.limit_key))];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <Loader2 className="size-5 animate-spin mr-2" />
        {t('loading')}
      </div>
    );
  }

  if (!plans) {
    return (
      <div className="flex items-center justify-center h-64 text-destructive">{t('error')}</div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
          <p className="text-muted-foreground mt-2">{t('description')}</p>
        </div>
        <Dialog open={creating} onOpenChange={setCreating}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              {t('create')}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('create_title')}</DialogTitle>
            </DialogHeader>
            <PlanForm onSave={handleSave} onCancel={() => setCreating(false)} t={t} />
          </DialogContent>
        </Dialog>
      </div>

      {plans.map((plan) => {
        const planFeatureKeys = getPlanFeatureKeys(plan.key);
        const planLimitsList = getPlanLimitsList(plan.key);
        const planFeatureIdMap = new Map(
          planFeatures
            .filter((pf) => pf.plan_key === plan.key)
            .map((pf) => [pf.feature_key, pf.id]),
        );
        const usedLimitKeys = new Set(planLimitsList.map((pl) => pl.limit_key));
        const _availableLimitKeys = allLimitKeys.filter((k) => !usedLimitKeys.has(k));

        return (
          <Card key={plan.id}>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <CreditCard className="w-5 h-5" />
                  <div>
                    <CardTitle>{plan.name}</CardTitle>
                    <CardDescription>
                      {plan.key} &middot;{' '}
                      {plan.priceMonthly > 0 ? `$${plan.priceMonthly}` : t('free')}
                    </CardDescription>
                  </div>
                </div>
                <div className="flex gap-1">
                  <Dialog>
                    <DialogTrigger asChild>
                      <Button variant="ghost" size="icon" onClick={() => setEditing(plan)}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                    </DialogTrigger>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>{t('edit_title')}</DialogTitle>
                      </DialogHeader>
                      {editing?.id === plan.id && (
                        <PlanForm
                          initial={plan}
                          onSave={handleSave}
                          onCancel={() => setEditing(null)}
                          t={t}
                        />
                      )}
                    </DialogContent>
                  </Dialog>
                  <Dialog
                    open={deleting?.id === plan.id}
                    onOpenChange={(o) => !o && setDeleting(null)}
                  >
                    <Button variant="ghost" size="icon" onClick={() => setDeleting(plan)}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                    <DialogContent>
                      <DialogHeader>
                        <DialogTitle>{t('delete_title')}</DialogTitle>
                        <DialogDescription>{t('delete_desc')}</DialogDescription>
                      </DialogHeader>
                      <DialogFooter>
                        <Button variant="outline" onClick={() => setDeleting(null)}>
                          {t('cancel')}
                        </Button>
                        <Button variant="destructive" onClick={() => handleDelete(plan.id)}>
                          {t('delete_title')}
                        </Button>
                      </DialogFooter>
                    </DialogContent>
                  </Dialog>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {/* Features section */}
                <div>
                  <h4 className="text-sm font-medium mb-2">{t('features_label')}</h4>
                  <div className="flex flex-wrap gap-2">
                    {planFeatureKeys.map((fk) => (
                      <Badge key={fk} variant="secondary" className="gap-1">
                        {fk}
                        <button
                          type="button"
                          onClick={() => {
                            const pfId = planFeatureIdMap.get(fk);
                            if (pfId) removeFeatureFromPlan(pfId);
                          }}
                          className="ml-1 hover:text-destructive"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <Select value={addingFeature ?? ''} onValueChange={(v) => setAddingFeature(v)}>
                      <SelectTrigger className="w-48">
                        <SelectValue placeholder={t('feature_placeholder')} />
                      </SelectTrigger>
                      <SelectContent>
                        {allFeatures
                          .filter((f) => !planFeatureKeys.includes(f.key))
                          .map((f) => (
                            <SelectItem key={f.key} value={f.key}>
                              {f.name}
                            </SelectItem>
                          ))}
                      </SelectContent>
                    </Select>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!addingFeature}
                      onClick={() => {
                        if (addingFeature) addFeatureToPlan(plan.key, addingFeature);
                      }}
                    >
                      <Plus className="w-4 h-4 mr-1" />
                      {t('add_feature')}
                    </Button>
                  </div>
                </div>

                {/* Limits section */}
                <div>
                  <h4 className="text-sm font-medium mb-2">Limits</h4>
                  <div className="flex flex-wrap gap-2">
                    {planLimitsList.map((pl) => (
                      <Badge key={pl.id} variant="outline" className="gap-1">
                        <span className="font-mono text-xs">{pl.limit_key}:</span>
                        <span className="font-mono text-xs font-bold">
                          {pl.limit_value === -1 ? '∞' : pl.limit_value}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            const newVal = prompt(
                              `New value for ${pl.limit_key} (-1 = unlimited):`,
                              String(pl.limit_value),
                            );
                            if (newVal !== null) {
                              const num = Number.parseInt(newVal, 10);
                              if (!Number.isNaN(num)) updateLimit(pl.id, num);
                            }
                          }}
                          className="ml-1 hover:text-primary"
                        >
                          <Pencil className="w-3 h-3" />
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteLimit(pl.id)}
                          className="hover:text-destructive"
                        >
                          <X className="w-3 h-3" />
                        </button>
                      </Badge>
                    ))}
                  </div>
                  <div className="mt-2 flex gap-2">
                    <Input
                      placeholder="New limit key (e.g. max_storage_mb)"
                      className="w-48 h-8 text-xs"
                      value={addingLimit?.planKey === plan.key ? addingLimit.limitKey : ''}
                      onChange={(e) =>
                        setAddingLimit({ planKey: plan.key, limitKey: e.target.value })
                      }
                    />
                    <Input
                      type="number"
                      placeholder="Value (-1 = ∞)"
                      className="w-24 h-8 text-xs"
                      id={`limit-val-${plan.key}`}
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!addingLimit?.limitKey}
                      onClick={() => {
                        if (addingLimit?.limitKey) {
                          const el = document.getElementById(
                            `limit-val-${plan.key}`,
                          ) as HTMLInputElement;
                          const val = el ? Number.parseInt(el.value, 10) : -1;
                          addLimitToPlan(
                            plan.key,
                            addingLimit.limitKey,
                            Number.isNaN(val) ? -1 : val,
                          );
                        }
                      }}
                    >
                      <Plus className="w-4 h-4 mr-1" />
                      Add
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function PlanForm({
  initial,
  onSave,
  onCancel,
  t,
}: {
  initial?: PlanInfo;
  onSave: (plan: Partial<PlanInfo>) => Promise<void>;
  onCancel: () => void;
  t: (key: string) => string;
}) {
  const [key, setKey] = useState(initial?.key ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [priceMonthly, setPriceMonthly] = useState(initial?.priceMonthly ?? 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await onSave({
      id: initial?.id,
      key,
      name,
      priceMonthly,
    } as any);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>{t('key_label')}</Label>
        <Input value={key} onChange={(e) => setKey(e.target.value)} required />
      </div>
      <div className="space-y-2">
        <Label>{t('name_label')}</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="space-y-2">
        <Label>{t('price_label')}</Label>
        <Input
          type="number"
          min={0}
          value={priceMonthly}
          onChange={(e) => setPriceMonthly(Number(e.target.value))}
        />
      </div>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onCancel}>
          {t('cancel')}
        </Button>
        <Button type="submit">{initial ? t('save') : t('create')}</Button>
      </DialogFooter>
    </form>
  );
}
