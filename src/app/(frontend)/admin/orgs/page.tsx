'use client';

import { Loader2, Pencil, Trash2 } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { OrgAvatar } from '@/components/ui/org-avatar';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

interface OrgRow {
  id: string;
  name: string;
  plan: string;
  created_at: string;
  member_count: number;
  group_count: number;
  role_count: number;
}

export default function AdminOrgsListPage() {
  const t = useTranslations('AdminOrgsListPage');
  const [orgs, setOrgs] = useState<OrgRow[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<OrgRow | null>(null);
  const [editName, setEditName] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<OrgRow | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/admin/organizations');
      const json = await res.json();
      if (json.success) setOrgs(json.data);
      else toast.error(t('load_error'));
    } catch {
      toast.error(t('load_error'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSave() {
    if (!editing || !editName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/admin/organizations/${editing.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: editName.trim() }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(t('edit_success'));
        setEditing(null);
        load();
      } else {
        toast.error(t('edit_error'));
      }
    } catch {
      toast.error(t('edit_error'));
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!deleting) return;
    setDeletingId(deleting.id);
    try {
      const res = await fetch(`/api/v1/admin/organizations/${deleting.id}`, {
        method: 'DELETE',
      });
      const json = await res.json();
      if (json.success) {
        toast.success(t('delete_success'));
        setDeleting(null);
        load();
      } else {
        toast.error(t('delete_error'));
      }
    } catch {
      toast.error(t('delete_error'));
    } finally {
      setDeletingId(null);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">{t('title')}</h1>
        <p className="text-muted-foreground mt-2">{t('description')}</p>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[40px]" />
              <TableHead>{t('col_name')}</TableHead>
              <TableHead>{t('col_plan')}</TableHead>
              <TableHead className="text-center">{t('col_members')}</TableHead>
              <TableHead className="text-center">{t('col_groups')}</TableHead>
              <TableHead className="text-center">{t('col_roles')}</TableHead>
              <TableHead className="text-right">{t('col_actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {orgs?.length === 0 && (
              <TableRow>
                <TableCell colSpan={7} className="text-center py-12 text-muted-foreground">
                  {t('empty')}
                </TableCell>
              </TableRow>
            )}
            {orgs?.map((org) => (
              <TableRow key={org.id}>
                <TableCell>
                  <OrgAvatar orgId={org.id} name={org.name} size={28} />
                </TableCell>
                <TableCell>
                  <a
                    href={`/admin/orgs/${org.id}`}
                    className="font-medium hover:underline underline-offset-2"
                  >
                    {org.name}
                  </a>
                </TableCell>
                <TableCell>
                  <span className="capitalize text-sm">{org.plan}</span>
                </TableCell>
                <TableCell className="text-center text-sm">{org.member_count}</TableCell>
                <TableCell className="text-center text-sm">{org.group_count}</TableCell>
                <TableCell className="text-center text-sm">{org.role_count}</TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-1">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => {
                        setEditing(org);
                        setEditName(org.name);
                      }}
                    >
                      <Pencil className="w-4 h-4" />
                    </Button>
                    <Button variant="ghost" size="icon" onClick={() => setDeleting(org)}>
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Edit Dialog */}
      <Dialog open={!!editing} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('edit_title')}</DialogTitle>
            <DialogDescription>{t('edit_desc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <Label htmlFor="edit-name">{t('edit_label')}</Label>
            <Input id="edit-name" value={editName} onChange={(e) => setEditName(e.target.value)} />
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditing(null)}>
              {t('cancel')}
            </Button>
            <Button onClick={handleSave} disabled={saving || !editName.trim()}>
              {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t('save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Dialog */}
      <Dialog open={!!deleting} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('delete_title')}</DialogTitle>
            <DialogDescription>
              {t('delete_desc', { name: deleting?.name ?? '' })}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              {t('cancel')}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDelete}
              disabled={deletingId === deleting?.id}
            >
              {deletingId === deleting?.id && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              {t('delete_confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
