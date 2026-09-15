'use client';

import {
  Button,
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@studiq/ui';
import { Check, Loader2, Pencil, Plus, Trash2, UserCog, X } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

interface UserOverride {
  id: string;
  user_id: string;
  feature_key: string;
  is_enabled: boolean;
  reason: string | null;
  expires_at: string | null;
  created_at: string;
}

export default function AdminUserOverridesPage() {
  const t = useTranslations('AdminUserOverridesPage');
  const [data, setData] = useState<UserOverride[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<UserOverride | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<UserOverride | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/admin/user-overrides');
      const json = await res.json();
      if (json.success) setData(json.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSave(override: Record<string, unknown>) {
    const url = override.id
      ? `/api/v1/admin/user-overrides/${override.id}`
      : '/api/v1/admin/user-overrides';
    const method = override.id ? 'PUT' : 'POST';

    const body: Record<string, unknown> = {};
    if (override.userId !== undefined) body.userId = override.userId;
    if (override.featureKey !== undefined) body.featureKey = override.featureKey;
    if (override.isEnabled !== undefined) body.isEnabled = override.isEnabled;
    if (override.reason !== undefined) body.reason = override.reason;
    if (override.expiresAt !== undefined) body.expiresAt = override.expiresAt;

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(override.id ? t('saved') : t('created'));
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
      const res = await fetch(`/api/v1/admin/user-overrides/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        toast.success(t('deleted'));
        setDeleting(null);
        load();
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
        <Button onClick={() => setCreating(true)}>
          <Plus className="w-4 h-4 mr-2" />
          {t('create')}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <UserCog className="w-5 h-5" />
            {t('title')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('user_id_label')}</TableHead>
                <TableHead>{t('feature_key_label')}</TableHead>
                <TableHead className="text-center">{t('is_enabled_label')}</TableHead>
                <TableHead>{t('reason_label')}</TableHead>
                <TableHead>{t('expires_at_label')}</TableHead>
                <TableHead className="text-right">{t('actions_label')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.map((override) => (
                <TableRow key={override.id}>
                  <TableCell className="font-mono text-xs truncate max-w-[120px]">
                    {override.user_id}
                  </TableCell>
                  <TableCell className="font-mono text-sm">{override.feature_key}</TableCell>
                  <TableCell className="text-center">
                    {override.is_enabled ? (
                      <Check className="w-4 h-4 text-green-500 mx-auto" />
                    ) : (
                      <X className="w-4 h-4 text-red-400 mx-auto" />
                    )}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground truncate max-w-[200px]">
                    {override.reason ?? '—'}
                  </TableCell>
                  <TableCell className="text-sm text-muted-foreground">
                    {override.expires_at ? new Date(override.expires_at).toLocaleDateString() : '—'}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Dialog
                        open={editing?.id === override.id}
                        onOpenChange={(o) => !o && setEditing(null)}
                      >
                        <Button variant="ghost" size="icon" onClick={() => setEditing(override)}>
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>{t('edit_title')}</DialogTitle>
                          </DialogHeader>
                          {editing?.id === override.id && (
                            <UserOverrideForm
                              initial={override}
                              onSave={handleSave}
                              onCancel={() => setEditing(null)}
                              t={t}
                            />
                          )}
                        </DialogContent>
                      </Dialog>
                      <Dialog
                        open={deleting?.id === override.id}
                        onOpenChange={(o) => !o && setDeleting(null)}
                      >
                        <Button variant="ghost" size="icon" onClick={() => setDeleting(override)}>
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
                            <Button variant="destructive" onClick={() => handleDelete(override.id)}>
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

      <Dialog open={creating} onOpenChange={setCreating}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('create_title')}</DialogTitle>
          </DialogHeader>
          <UserOverrideForm onSave={handleSave} onCancel={() => setCreating(false)} t={t} />
        </DialogContent>
      </Dialog>
    </div>
  );
}

function UserOverrideForm({
  initial,
  onSave,
  onCancel,
  t,
}: {
  initial?: UserOverride;
  onSave: (override: Partial<UserOverride>) => Promise<void>;
  onCancel: () => void;
  t: (key: string) => string;
}) {
  const [userId, setUserId] = useState(initial?.user_id ?? '');
  const [featureKey, setFeatureKey] = useState(initial?.feature_key ?? '');
  const [isEnabled, setIsEnabled] = useState(initial?.is_enabled ?? true);
  const [reason, setReason] = useState(initial?.reason ?? '');
  const [expiresAt, setExpiresAt] = useState(
    initial?.expires_at ? initial.expires_at.slice(0, 10) : '',
  );

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await onSave({
      id: initial?.id,
      userId,
      featureKey,
      isEnabled,
      reason: reason || null,
      expiresAt: expiresAt || null,
    } as any);
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {!initial && (
        <>
          <div className="space-y-2">
            <Label>{t('user_id_label')}</Label>
            <Input value={userId} onChange={(e) => setUserId(e.target.value)} required />
          </div>
          <div className="space-y-2">
            <Label>{t('feature_key_label')}</Label>
            <Input value={featureKey} onChange={(e) => setFeatureKey(e.target.value)} required />
          </div>
        </>
      )}
      <div className="flex items-center gap-2">
        <Switch checked={isEnabled} onCheckedChange={setIsEnabled} />
        <Label>{isEnabled ? t('override_enabled') : t('override_disabled')}</Label>
      </div>
      <div className="space-y-2">
        <Label>{t('reason_label')}</Label>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} />
      </div>
      <div className="space-y-2">
        <Label>{t('expires_at_label')}</Label>
        <Input type="date" value={expiresAt} onChange={(e) => setExpiresAt(e.target.value)} />
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
