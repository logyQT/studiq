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
  Switch,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@studiq/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ConfirmDialog } from '@/app/(frontend)/components/confirm-dialog';
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

type UserOverride = {
  id: string;
  user_id: string;
  feature_key: string;
  is_enabled: boolean;
  reason: string | null;
  expires_at: string | null;
  created_at: string;
};

type FormData = {
  user_id: string;
  feature_key: string;
  isEnabled: boolean;
  reason: string;
  expires_at: string;
};

const EMPTY_FORM: FormData = {
  user_id: '',
  feature_key: '',
  isEnabled: true,
  reason: '',
  expires_at: '',
};

export default function UserOverridesPage() {
  const t = useTranslations('UserOverrides');
  const tc = useTranslations('Common');
  const queryClient = useQueryClient();

  const { data: overrides = [], isLoading } = useQuery({
    queryKey: queryKeys.userOverrides.all,
    queryFn: () => apiGet<UserOverride[]>('/user-overrides'),
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<UserOverride | null>(null);
  const [form, setForm] = useState<FormData>(EMPTY_FORM);
  const [deleteTarget, setDeleteTarget] = useState<UserOverride | null>(null);

  const createMutation = useMutation({
    mutationFn: (data: FormData) =>
      apiPost('/user-overrides', {
        userId: data.user_id,
        featureKey: data.feature_key,
        isEnabled: data.isEnabled,
        reason: data.reason || undefined,
        expiresAt: data.expires_at || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.userOverrides.all });
      setDialogOpen(false);
      setForm(EMPTY_FORM);
    },
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, ...data }: FormData & { id: string }) =>
      apiPut(`/user-overrides/${id}`, {
        isEnabled: data.isEnabled,
        reason: data.reason || undefined,
        expiresAt: data.expires_at || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.userOverrides.all });
      setDialogOpen(false);
      setEditing(null);
      setForm(EMPTY_FORM);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiDelete(`/user-overrides/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: queryKeys.userOverrides.all });
      setDeleteTarget(null);
    },
  });

  function openCreate() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEdit(override: UserOverride) {
    setEditing(override);
    setForm({
      user_id: override.user_id,
      feature_key: override.feature_key,
      isEnabled: override.is_enabled,
      reason: override.reason ?? '',
      expires_at: override.expires_at ? override.expires_at.slice(0, 16) : '',
    });
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
          {isLoading ? (
            <p className="text-muted-foreground">{tc('loading')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('col_user')}</TableHead>
                  <TableHead>{t('col_feature')}</TableHead>
                  <TableHead>{t('col_enabled')}</TableHead>
                  <TableHead>{t('col_reason')}</TableHead>
                  <TableHead>{t('col_expires')}</TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {overrides.map((o) => (
                  <TableRow key={o.id}>
                    <TableCell className="font-mono text-xs">{o.user_id.slice(0, 8)}…</TableCell>
                    <TableCell className="font-mono text-sm">{o.feature_key}</TableCell>
                    <TableCell>
                      <span className={o.is_enabled ? 'text-green-600' : 'text-muted-foreground'}>
                        {o.is_enabled ? tc('confirm') : tc('cancel')}
                      </span>
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-48 truncate">
                      {o.reason ?? '—'}
                    </TableCell>
                    <TableCell className="text-sm">
                      {o.expires_at ? new Date(o.expires_at).toLocaleDateString() : '—'}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button variant="ghost" size="icon" onClick={() => openEdit(o)}>
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => setDeleteTarget(o)}>
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {overrides.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
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
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? t('edit') : t('create')}</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label>{t('col_user')}</Label>
              <Input
                value={form.user_id}
                onChange={(e) => setForm({ ...form, user_id: e.target.value })}
                disabled={!!editing}
                required
                placeholder="UUID"
              />
            </div>
            <div className="space-y-2">
              <Label>{t('col_feature')}</Label>
              <Input
                value={form.feature_key}
                onChange={(e) => setForm({ ...form, feature_key: e.target.value })}
                disabled={!!editing}
                required
              />
            </div>
            <div className="flex items-center gap-2">
              <Switch
                checked={form.isEnabled}
                onCheckedChange={(checked) => setForm({ ...form, isEnabled: checked })}
              />
              <Label>{t('col_enabled')}</Label>
            </div>
            <div className="space-y-2">
              <Label>{t('col_reason')}</Label>
              <Input
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('col_expires')}</Label>
              <Input
                type="datetime-local"
                value={form.expires_at}
                onChange={(e) => setForm({ ...form, expires_at: e.target.value })}
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
        description={t('delete_desc')}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        confirmLabel={tc('delete')}
        destructive
      />
    </div>
  );
}
