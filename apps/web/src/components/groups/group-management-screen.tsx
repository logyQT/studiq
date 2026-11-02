'use client';

import {
  Badge,
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
  DialogTrigger,
  Input,
  Label,
  MultiSelect,
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
import { Layers, Loader2, Lock, Pencil, Plus, Trash2, Users } from 'lucide-react';
import type { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { ReportQuestionDialog } from '@/components/question-reports/report-question-dialog';
import { useFeature } from '@/hooks/use-feature';
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api';
import {
  type AddableOrgMember,
  ensureMemberRoles,
  type GroupMemberOption,
  type GroupMemberRole,
  toGroupMemberOptions,
} from '@/lib/group-role';
import { SrLabel } from '@/components/shared/sr-label';
import { EmptyState, ErrorState } from '@/components/shared/empty-state';

interface Group {
  id: string;
  name: string;
  description: string | null;
  created_at: string;
  memberCount: number;
  teacherCount: number;
  canManage: boolean;
}

interface GroupManagementScreenProps {
  t: ReturnType<typeof useTranslations>;
}

export function GroupManagementScreen({ t }: GroupManagementScreenProps) {
  // Write actions need the `group.manage` feature (the API enforces it with
  // `requireFeature`). While `/features/me` is in flight the checker returns a
  // provisional `false`, so the controls stay hidden until it resolves and
  // entitled users never see a flash of actions that would fail with 403.
  const canWrite = useFeature()('group.manage');
  const [data, setData] = useState<Group[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
  const [editing, setEditing] = useState<Group | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState<Group | null>(null);
  const [managingMembers, setManagingMembers] = useState<Group | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(false);
    try {
      setData(await apiGet<Group[]>('/api/v1/organization/groups'));
    } catch {
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleSave(group: { name: string; description?: string | null }, id?: string) {
    try {
      if (id) {
        await apiPut<unknown>(`/api/v1/organization/groups/${id}`, group);
      } else {
        await apiPost<unknown>('/api/v1/organization/groups', group);
      }
      toast.success(id ? t('group_updated') : t('group_created'));
      setEditing(null);
      setCreating(false);
      void load();
    } catch {
      toast.error(id ? t('update_failed') : t('create_failed'));
    }
  }

  async function handleDelete(id: string) {
    try {
      await apiDelete(`/api/v1/organization/groups/${id}`);
      toast.success(t('group_deleted'));
      setDeleting(null);
      void load();
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
        {canWrite && (
          <Dialog open={creating} onOpenChange={setCreating}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="w-4 h-4 mr-2" />
                {t('new_group')}
              </Button>
            </DialogTrigger>
            <DialogContent aria-describedby={undefined}>
              <DialogHeader>
                <DialogTitle>{t('create_title')}</DialogTitle>
              </DialogHeader>
              <GroupForm onSave={(g) => handleSave(g)} onCancel={() => setCreating(false)} t={t} />
            </DialogContent>
          </Dialog>
        )}
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
                      {group.canManage && canWrite ? (
                        <>
                          <Button
                            variant="ghost"
                            size="icon"
                            title={t('manage_members')}
                            aria-label={t('manage_members')}
                            onClick={() => setManagingMembers(group)}
                          >
                            <Users className="w-4 h-4" />
                          </Button>
                          <Dialog>
                            <DialogTrigger asChild>
                              <Button variant="ghost" size="icon" onClick={() => setEditing(group)}>
                                <Pencil className="w-4 h-4" />
                                <SrLabel k="edit_group" values={{ name: group.name }} />
                              </Button>
                            </DialogTrigger>
                            <DialogContent aria-describedby={undefined}>
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
                              <SrLabel k="delete_group" values={{ name: group.name }} />
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
                                <Button
                                  variant="destructive"
                                  onClick={() => handleDelete(group.id)}
                                >
                                  {t('delete')}
                                </Button>
                              </DialogFooter>
                            </DialogContent>
                          </Dialog>
                        </>
                      ) : (
                        <>
                          {!group.canManage && (
                            <span
                              title={t('not_owned')}
                              className="inline-flex h-9 w-9 items-center justify-center text-muted-foreground/50"
                            >
                              <Lock className="w-4 h-4" />
                            </span>
                          )}
                          <ReportQuestionDialog groupId={group.id} />
                        </>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
              {(!data || data.length === 0) && (
                <TableRow>
                  <TableCell colSpan={4} className="p-0">
                    {loadError ? (
                      <ErrorState compact onRetry={load} />
                    ) : (
                      <EmptyState compact icon={Users} title={t('no_groups')} />
                    )}
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog
        open={canWrite && !!managingMembers}
        onOpenChange={(o) => !o && setManagingMembers(null)}
      >
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{t('manage_members')}</DialogTitle>
            <DialogDescription>{t('manage_members_desc')}</DialogDescription>
          </DialogHeader>
          {managingMembers && (
            <ManageMembersForm
              group={managingMembers}
              onDone={() => {
                setManagingMembers(null);
                void load();
              }}
              t={t}
            />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ManageMembersForm({
  group,
  onDone,
  t,
}: {
  group: Group;
  onDone: () => void;
  t: (key: string) => string;
}) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [options, setOptions] = useState<GroupMemberOption[]>([]);
  const [roleByUserId, setRoleByUserId] = useState<Record<string, GroupMemberRole>>({});
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function run() {
      setLoading(true);
      try {
        const [addable, current] = await Promise.all([
          apiGet<AddableOrgMember[]>(`/api/v1/organization/groups/${group.id}/addable-members`),
          apiGet<{ userId: string; role: GroupMemberRole }[]>(
            `/api/v1/organization/groups/${group.id}/members`,
          ),
        ]);
        if (cancelled) return;

        setOptions(toGroupMemberOptions(addable));
        const roles: Record<string, GroupMemberRole> = {};
        for (const m of current) {
          roles[m.userId] = m.role;
        }
        setRoleByUserId(roles);
        setSelected(Object.keys(roles));
      } catch {
        // A failed roster fetch leaves the picker empty instead of rejecting the effect.
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void run();
    return () => {
      cancelled = true;
    };
    // The fetch URLs inside the async `run()` use `group.id`; switching group must refetch its
    // members even though the dependency is only visible inside the nested async body.
  }, [group.id]);

  async function handleSave() {
    setSaving(true);
    try {
      const members = selected.map((userId) => ({
        userId,
        role: roleByUserId[userId] ?? 'member',
      }));
      await apiPut<unknown>(`/api/v1/organization/groups/${group.id}/members`, { members });
      toast.success(t('members_updated'));
      onDone();
    } catch {
      toast.error(t('members_update_failed'));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-8 text-muted-foreground">
        <Loader2 className="size-5 animate-spin mr-2" />
        {t('common_loading')}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <Label>{t('members_label')}</Label>
        <MultiSelect
          options={options}
          selected={selected}
          onChange={(ids) => {
            setSelected(ids);
            setRoleByUserId((prev) => ensureMemberRoles(prev, ids, options));
          }}
          placeholder={t('members_placeholder')}
          emptyText={t('members_empty')}
        />
      </div>
      {selected.length > 0 && (
        <div className="space-y-2">
          <Label>{t('member_roles_label')}</Label>
          <div className="max-h-[40vh] space-y-2 overflow-y-auto pr-1">
            {selected.map((userId) => {
              const option = options.find((o) => o.value === userId);
              const label = option?.label ?? userId;
              return (
                <div key={userId} className="flex items-center gap-3">
                  <span className="flex-1 truncate text-sm">{label}</span>
                  <Select
                    value={roleByUserId[userId] ?? 'member'}
                    onValueChange={(value) => {
                      if (value !== 'teacher' && value !== 'member') return;
                      setRoleByUserId((prev) => ({ ...prev, [userId]: value }));
                    }}
                  >
                    <SelectTrigger
                      className="w-32 h-8"
                      aria-label={`${label}: ${t('member_roles_label')}`}
                    >
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="teacher">{t('role_teacher')}</SelectItem>
                      <SelectItem value="member">{t('role_member')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              );
            })}
          </div>
        </div>
      )}
      <DialogFooter>
        <Button variant="outline" onClick={onDone}>
          {t('cancel')}
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? t('saving') : t('save')}
        </Button>
      </DialogFooter>
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
  onSave: (group: { name: string; description?: string | null }) => Promise<void>;
  onCancel: () => void;
  t: (key: string) => string;
}) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // `required` accepts spaces, so guard the whitespace-only case here; the API
    // rejects it too, but a toast explains it instead of a generic failure.
    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      toast.error(t('name_required'));
      return;
    }
    if (trimmedName.length < 3) {
      toast.error(t('name_too_short'));
      return;
    }
    const trimmed = description.trim();
    // Edit: always send the key (null clears it). Create: omit when empty.
    await onSave({
      name: trimmedName,
      ...(initial
        ? { description: trimmed === '' ? null : trimmed }
        : trimmed
          ? { description: trimmed }
          : {}),
    });
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div className="space-y-2">
        <Label>{t('name_label')}</Label>
        <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={64} required />
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
