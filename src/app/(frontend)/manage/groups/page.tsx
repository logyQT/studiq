'use client';

import { Layers, Loader2, Pencil, Plus, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Badge } from '@/components/ui/badge';
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface Group {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  memberCount: number;
  teacherCount: number;
}

export default function GroupsPage() {
  const t = useTranslations('ManageGroupsPage');
  const [data, setData] = useState<Group[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Group | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Group | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/organization/groups');
      const json = await res.json();
      if (json.success) setData(json.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSave(group: { name: string; description?: string }, id?: string) {
    const url = id ? `/api/v1/organization/groups/${id}` : '/api/v1/organization/groups';
    const method = id ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(group),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(id ? t('group_updated') : t('group_created'));
        setEditing(null);
        setCreating(false);
        load();
      } else {
        toast.error(t(json.error === 'UNPROCESSABLE_ENTITY' ? 'create_failed' : 'update_failed'));
      }
    } catch {
      toast.error(id ? t('update_failed') : t('create_failed'));
    }
  }

  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/v1/organization/groups/${id}`, { method: 'DELETE' });
      const json = await res.json();
      if (json.success) {
        toast.success(t('group_deleted'));
        setDeleting(null);
        load();
      } else {
        toast.error(t('delete_failed'));
      }
    } catch {
      toast.error(t('delete_failed'));
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        <Loader2 className="size-5 animate-spin mr-2" />
        {t('common_loading')}
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <Dialog open={creating} onOpenChange={setCreating}>
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              {t('new_group')}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('create_title')}</DialogTitle>
            </DialogHeader>
            <GroupForm onSave={(g) => handleSave(g)} onCancel={() => setCreating(false)} t={t} />
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Layers className="w-5 h-5" />
            {t('title')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('col_name')}</TableHead>
                <TableHead className="text-center">{t('col_members')}</TableHead>
                <TableHead className="text-center">{t('col_teachers')}</TableHead>
                <TableHead className="text-right">{t('col_actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.map((group) => (
                <TableRow key={group.id}>
                  <TableCell>
                    <div>
                      <p className="font-medium">{group.name}</p>
                      {group.description && (
                        <p className="text-xs text-muted-foreground">{group.description}</p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant="secondary">{group.memberCount}</Badge>
                  </TableCell>
                  <TableCell className="text-center">{group.teacherCount}</TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button variant="ghost" size="icon" onClick={() => setEditing(group)}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>{t('edit_title')}</DialogTitle>
                          </DialogHeader>
                          {editing?.id === group.id && (
                            <GroupForm
                              initial={group}
                              onSave={(g) => handleSave(g, group.id)}
                              onCancel={() => setEditing(null)}
                              t={t}
                            />
                          )}
                        </DialogContent>
                      </Dialog>
                      <Dialog
                        open={deleting?.id === group.id}
                        onOpenChange={(o) => !o && setDeleting(null)}
                      >
                        <Button variant="ghost" size="icon" onClick={() => setDeleting(group)}>
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
                            <Button variant="destructive" onClick={() => handleDelete(group.id)}>
                              {t('delete')}
                            </Button>
                          </DialogFooter>
                        </DialogContent>
                      </Dialog>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {(!data || data.length === 0) && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
                    {t('no_groups')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}

function GroupForm({
  initial,
  onSave,
  onCancel,
  t,
}: {
  initial?: Group;
  onSave: (group: { name: string; description?: string }) => Promise<void>;
  onCancel: () => void;
  t: (key: string) => string;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await onSave({
      name,
      description: description || undefined,
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>{t('name_label')}</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} required />
      </div>
      <div className="space-y-2">
        <Label>{t('description_label')}</Label>
        <Input value={description} onChange={(e) => setDescription(e.target.value)} />
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
