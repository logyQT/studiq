'use client';

import { Check, Flag, Loader2, Pencil, Plus, Trash2, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { Switch } from '@/components/ui/switch';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface FeatureFlag {
  id: string;
  key: string;
  name: string;
  description: string | null;
  is_enabled: boolean;
  rollout_percentage: number;
  created_at: string;
}

export default function AdminFeatureFlagsPage() {
  const t = useTranslations('AdminFeatureFlagsPage');
  const [data, setData] = useState<FeatureFlag[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<FeatureFlag | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<FeatureFlag | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/admin/feature-flags');
      const json = await res.json();
      if (json.success) setData(json.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSave(flag: Record<string, unknown>) {
    const url = flag.id ? `/api/v1/admin/feature-flags/${flag.id}` : '/api/v1/admin/feature-flags';
    const method = flag.id ? 'PUT' : 'POST';

    const body = {
      ...(flag.key !== undefined && { key: flag.key }),
      ...(flag.name !== undefined && { name: flag.name }),
      ...(flag.description !== undefined && { description: flag.description }),
      ...(flag.is_enabled !== undefined && { isEnabled: flag.is_enabled }),
      ...(flag.rollout_percentage !== undefined && { rolloutPercentage: flag.rollout_percentage }),
    };

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(flag.id ? t('saved') : t('created'));
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
      const res = await fetch(`/api/v1/admin/feature-flags/${id}`, { method: 'DELETE' });
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

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <Loader2 className="size-5 animate-spin mr-2" />
        {t('loading')}
      </div>
    );
  }

  if (!data) {
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
            <FeatureFlagForm onSave={handleSave} onCancel={() => setCreating(false)} t={t} />
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Flag className="w-5 h-5" />
            {t('title')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('key_label')}</TableHead>
                <TableHead>{t('name_label')}</TableHead>
                <TableHead>{t('description_label')}</TableHead>
                <TableHead className="text-center">{t('is_enabled_label')}</TableHead>
                <TableHead className="text-center">{t('rollout_label')}</TableHead>
                <TableHead className="text-right">{t('actions_label')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((flag) => (
                <TableRow key={flag.id}>
                  <TableCell className="font-mono text-sm">{flag.key}</TableCell>
                  <TableCell>{flag.name}</TableCell>
                  <TableCell className="text-muted-foreground text-sm max-w-xs truncate">
                    {flag.description}
                  </TableCell>
                  <TableCell className="text-center">
                    {flag.is_enabled ? (
                      <Check className="w-4 h-4 text-green-500 mx-auto" />
                    ) : (
                      <X className="w-4 h-4 text-red-400 mx-auto" />
                    )}
                  </TableCell>
                  <TableCell className="text-center">{flag.rollout_percentage}%</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button variant="ghost" size="icon" onClick={() => setEditing(flag)}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>{t('edit_title')}</DialogTitle>
                          </DialogHeader>
                          {editing?.id === flag.id && (
                            <FeatureFlagForm
                              initial={flag}
                              onSave={handleSave}
                              onCancel={() => setEditing(null)}
                              t={t}
                            />
                          )}
                        </DialogContent>
                      </Dialog>
                      <Dialog
                        open={deleting?.id === flag.id}
                        onOpenChange={(o) => !o && setDeleting(null)}
                      >
                        <Button variant="ghost" size="icon" onClick={() => setDeleting(flag)}>
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
                            <Button variant="destructive" onClick={() => handleDelete(flag.id)}>
                              {t('delete_title')}
                            </Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function FeatureFlagForm({
  initial,
  onSave,
  onCancel,
  t,
}: {
  initial?: FeatureFlag;
  onSave: (flag: Partial<FeatureFlag>) => Promise<void>;
  onCancel: () => void;
  t: (key: string) => string;
}) {
  const [key, setKey] = useState(initial?.key ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [isEnabled, setIsEnabled] = useState(initial?.is_enabled ?? true);
  const [rollout, setRollout] = useState(initial?.rollout_percentage ?? 100);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await onSave({
      id: initial?.id,
      key,
      name,
      description: description || null,
      is_enabled: isEnabled,
      rollout_percentage: rollout,
    } as any);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>{t('key_label')}</Label>
        <Input
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="e.g. new_feature"
          required
        />
      </div>
      <div className="space-y-2">
        <Label>{t('name_label')}</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="space-y-2">
        <Label>{t('description_label')}</Label>
        <Input value={description} onChange={(e) => setDescription(e.target.value)} />
      </div>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <Switch checked={isEnabled} onCheckedChange={setIsEnabled} />
          <Label>{t('is_enabled_label')}</Label>
        </div>
        <div className="flex items-center gap-2">
          <Label>{t('rollout_label')}</Label>
          <Input
            type="number"
            min={0}
            max={100}
            value={rollout}
            onChange={(e) => setRollout(Number(e.target.value))}
            className="w-20"
          />
        </div>
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
