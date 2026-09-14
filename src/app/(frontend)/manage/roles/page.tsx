'use client';

import { Loader2, Pencil, Plus, ShieldCheck, Trash2 } from 'lucide-react';
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

const PERMISSION_GROUPS = [
  {
    key: 'section_flashcards',
    permissions: ['flashcard.read', 'flashcard.create', 'flashcard.update', 'flashcard.delete'],
  },
  {
    key: 'section_decks',
    permissions: ['deck.read', 'deck.create', 'deck.update', 'deck.delete'],
  },
  {
    key: 'section_topics',
    permissions: ['topic.read', 'topic.create', 'topic.update', 'topic.delete'],
  },
  {
    key: 'section_question_banks',
    permissions: [
      'question_bank.read',
      'question_bank.create',
      'question_bank.update',
      'question_bank.delete',
    ],
  },
  {
    key: 'section_questions',
    permissions: ['question.read', 'question.create', 'question.update', 'question.delete'],
  },
];

const SCOPES = ['own', 'group', 'organization'] as const;

interface OrgRole {
  id: string;
  name: string;
  description: string | null;
  isSystem: boolean;
  memberCount: number;
  permissionCount: number;
}

interface OrgRoleDetail extends OrgRole {
  permissions: { permissionName: string; scope: string }[];
}

export default function RolesPage() {
  const t = useTranslations('ManageRolesPage');
  const [data, setData] = useState<OrgRole[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<OrgRole | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<OrgRole | null>(null);
  const [permRole, setPermRole] = useState<OrgRoleDetail | null>(null);
  const [permDialogOpen, setPermDialogOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/v1/organization/roles');
      const json = await res.json();
      if (json.success) setData(json.data);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSave(role: { name: string; description?: string | null }, id?: string) {
    const url = id ? `/api/v1/organization/roles/${id}` : '/api/v1/organization/roles';
    const method = id ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(role),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(id ? t('role_updated') : t('role_created'));
        setEditing(null);
        setCreating(false);
        load();
      } else {
        toast.error(t(id ? 'update_failed' : 'create_failed'));
      }
    } catch {
      toast.error(t(id ? 'update_failed' : 'create_failed'));
    }
  }

  async function handleDelete(id: string) {
    try {
      const res = await fetch(`/api/v1/organization/roles/${id}`, {
        method: 'DELETE',
      });
      const json = await res.json();
      if (json.success) {
        toast.success(t('role_deleted'));
        setDeleting(null);
        load();
      } else if (json.error === 'FORBIDDEN') {
        toast.error(t('cant_delete_system'));
        setDeleting(null);
      } else if (json.error === 'CONFLICT') {
        toast.error(t('cant_delete_has_members'));
        setDeleting(null);
      } else {
        toast.error(t('delete_failed'));
      }
    } catch {
      toast.error(t('delete_failed'));
    }
  }

  async function openPermEditor(role: OrgRole) {
    try {
      const res = await fetch(`/api/v1/organization/roles/${role.id}`);
      const json = await res.json();
      if (json.success) {
        setPermRole(json.data);
        setPermDialogOpen(true);
      }
    } catch {
      toast.error(t('perms_save_failed'));
    }
  }

  async function handleSavePermissions(
    roleId: string,
    permissions: { permissionName: string; scope: string }[],
  ) {
    try {
      const res = await fetch(`/api/v1/organization/roles/${roleId}/permissions`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ permissions }),
      });
      const json = await res.json();
      if (json.success) {
        toast.success(t('perms_saved'));
        setPermDialogOpen(false);
        setPermRole(null);
        load();
      } else {
        toast.error(t('perms_save_failed'));
      }
    } catch {
      toast.error(t('perms_save_failed'));
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
              {t('new_role')}
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{t('create_title')}</DialogTitle>
            </DialogHeader>
            <RoleForm onSave={(r) => handleSave(r)} onCancel={() => setCreating(false)} t={t} />
          </DialogContent>
        </Dialog>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ShieldCheck className="w-5 h-5" />
            {t('title')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('col_name')}</TableHead>
                <TableHead className="text-center">{t('col_type')}</TableHead>
                <TableHead className="text-center">{t('col_members')}</TableHead>
                <TableHead className="text-center">{t('col_permissions')}</TableHead>
                <TableHead className="text-right">{t('col_actions')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data?.map((role) => (
                <TableRow key={role.id}>
                  <TableCell>
                    <div>
                      <p className="font-medium">{role.name}</p>
                      {role.description && (
                        <p className="text-xs text-muted-foreground">{role.description}</p>
                      )}
                    </div>
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant={role.isSystem ? 'secondary' : 'default'}>
                      {role.isSystem ? t('type_system') : t('type_custom')}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    <Badge variant={role.memberCount > 0 ? 'secondary' : 'outline'}>
                      {role.memberCount}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-center">
                    {role.permissionCount} {t('col_permissions').toLowerCase()}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openPermEditor(role)}>
                        <ShieldCheck className="w-4 h-4" />
                      </Button>
                      <Dialog
                        open={editing?.id === role.id}
                        onOpenChange={(o) => !o && setEditing(null)}
                      >
                        <DialogTrigger asChild>
                          <Button variant="ghost" size="icon" onClick={() => setEditing(role)}>
                            <Pencil className="w-4 h-4" />
                          </Button>
                        </DialogTrigger>
                        <DialogContent>
                          <DialogHeader>
                            <DialogTitle>{t('edit_title')}</DialogTitle>
                          </DialogHeader>
                          {editing?.id === role.id && (
                            <RoleForm
                              initial={role}
                              onSave={(r) => handleSave(r, role.id)}
                              onCancel={() => setEditing(null)}
                              t={t}
                            />
                          )}
                        </DialogContent>
                      </Dialog>
                      {!role.isSystem && (
                        <Dialog
                          open={deleting?.id === role.id}
                          onOpenChange={(o) => !o && setDeleting(null)}
                        >
                          <DialogTrigger asChild>
                            <Button variant="ghost" size="icon" onClick={() => setDeleting(role)}>
                              <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>{t('delete_title')}</DialogTitle>
                              <DialogDescription>{t('delete_desc')}</DialogDescription>
                            </DialogHeader>
                            <DialogFooter>
                              <Button variant="outline" onClick={() => setDeleting(null)}>
                                {t('common_cancel')}
                              </Button>
                              <Button variant="destructive" onClick={() => handleDelete(role.id)}>
                                {t('common_delete')}
                              </Button>
                            </DialogFooter>
                          </DialogContent>
                        </Dialog>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {(!data || data.length === 0) && (
                <TableRow>
                  <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                    {t('no_roles')}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <PermissionEditorDialog
        key={permRole?.id ?? 'perm-editor'}
        open={permDialogOpen}
        onOpenChange={(o) => {
          setPermDialogOpen(o);
          if (!o) setPermRole(null);
        }}
        role={permRole}
        t={t}
        onSave={handleSavePermissions}
      />
    </div>
  );
}

function RoleForm({
  initial,
  onSave,
  onCancel,
  t,
}: {
  initial?: OrgRole;
  onSave: (role: { name: string; description?: string | null }) => Promise<void>;
  onCancel: () => void;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    await onSave({
      name,
      description: description || null,
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
          {t('common_cancel')}
        </Button>
        <Button type="submit">{initial ? t('common_save') : t('common_create')}</Button>
      </DialogFooter>
    </form>
  );
}

function PermissionEditorDialog({
  open,
  onOpenChange,
  role,
  t,
  onSave,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  role: OrgRoleDetail | null;
  t: (key: string, values?: Record<string, string | number>) => string;
  onSave: (
    roleId: string,
    permissions: { permissionName: string; scope: string }[],
  ) => Promise<void>;
}) {
  const existingPerms = role
    ? new Map(role.permissions.map((p) => [p.permissionName, p.scope]))
    : new Map<string, string>();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{t('perms_title', { name: role?.name ?? '' })}</DialogTitle>
        </DialogHeader>
        <div className="space-y-6 py-4">
          {PERMISSION_GROUPS.map((group) => (
            <div key={group.key}>
              <h3 className="text-sm font-semibold text-muted-foreground mb-2 uppercase tracking-wide">
                {t(group.key)}
              </h3>
              <div className="space-y-2">
                {group.permissions.map((perm) => (
                  <PermissionRow
                    key={perm}
                    permissionName={perm}
                    selected={existingPerms.get(perm) ?? ''}
                    t={t}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common_cancel')}
          </Button>
          <Button
            onClick={() => {
              if (!role) return;
              const permissions: { permissionName: string; scope: string }[] = [];
              const radios = document.querySelectorAll<HTMLInputElement>(
                'input[data-perm-radio="true"]:checked',
              );
              radios.forEach((radio) => {
                permissions.push({
                  permissionName: radio.name,
                  scope: radio.value,
                });
              });
              onSave(role.id, permissions);
            }}
          >
            {t('perms_save')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PermissionRow({
  permissionName,
  selected,
  t,
}: {
  permissionName: string;
  selected: string;
  t: (key: string, values?: Record<string, string | number>) => string;
}) {
  const label = permissionName.replace(/^[^.]*\./, '').replace(/^./, (c) => c.toUpperCase());

  return (
    <div className="flex items-center justify-between gap-4 text-sm">
      <span className="flex-1 font-medium">{label}</span>
      <div className="flex gap-4">
        {SCOPES.map((scope) => (
          <label key={scope} className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              name={permissionName}
              value={scope}
              defaultChecked={selected === scope}
              data-perm-radio="true"
              className="size-4"
            />
            <span className="text-muted-foreground">{t(`scope_${scope}`)}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
