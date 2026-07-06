'use client';

import { Search, Shield, UserMinus } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/components/providers/AuthProvider';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { UserAvatar } from '@/components/ui/user-avatar';

interface GroupInfo {
  id: string;
  name: string;
  role: string;
}

interface Member {
  id: string;
  email: string;
  full_name: string | null;
  orgRoleName: string;
  created_at: string;
  groups: GroupInfo[];
}

interface OrgGroup {
  id: string;
  name: string;
  description: string | null;
}

export default function MembersPage() {
  const t = useTranslations('ManageMembersPage');
  const { user } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [orgGroups, setOrgGroups] = useState<OrgGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState('all');
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [changingRole, setChangingRole] = useState<{ id: string; role: string } | null>(null);
  const [managingMember, setManagingMember] = useState<Member | null>(null);
  const [groupAssignments, setGroupAssignments] = useState<
    Record<string, { checked: boolean; role: string }>
  >({});

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [membersRes, groupsRes] = await Promise.all([
        fetch('/api/v1/organization/members'),
        fetch('/api/v1/organization/groups'),
      ]);
      const membersJson = await membersRes.json();
      const groupsJson = await groupsRes.json();
      if (membersJson.success && Array.isArray(membersJson.data)) {
        setMembers(membersJson.data);
      }
      if (groupsJson.success && Array.isArray(groupsJson.data)) {
        setOrgGroups(groupsJson.data);
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = members.filter((m) => {
    const matchesSearch =
      m.email.toLowerCase().includes(search.toLowerCase()) ||
      (m.full_name?.toLowerCase().includes(search.toLowerCase()) ?? false);
    const matchesRole = filterRole === 'all' || m.orgRoleName === filterRole;
    return matchesSearch && matchesRole;
  });

  function openManageDialog(member: Member) {
    setManagingMember(member);
    const assignments: Record<string, { checked: boolean; role: string }> = {};
    for (const group of orgGroups) {
      const membership = member.groups.find((g) => g.id === group.id);
      assignments[group.id] = {
        checked: !!membership,
        role: membership?.role ?? 'member',
      };
    }
    setGroupAssignments(assignments);
  }

  async function handleSaveGroupMemberships() {
    if (!managingMember) return;

    const prevGroups = managingMember.groups;
    const changedGroups: { groupId: string; add: boolean; role: string }[] = [];

    for (const group of orgGroups) {
      const assignment = groupAssignments[group.id];
      const wasMember = prevGroups.some((g) => g.id === group.id);
      const isMember = assignment?.checked ?? false;
      const newRole = assignment?.role ?? 'member';

      if (
        isMember !== wasMember ||
        (isMember && newRole !== prevGroups.find((g) => g.id === group.id)?.role)
      ) {
        changedGroups.push({ groupId: group.id, add: isMember, role: newRole });
      }
    }

    if (changedGroups.length === 0) {
      setManagingMember(null);
      return;
    }

    try {
      for (const change of changedGroups) {
        const res = await fetch(`/api/v1/organization/groups/${change.groupId}/members`);
        const json = await res.json();
        if (!json.success) throw new Error();

        let currentMembers: { userId: string; role: string }[] = json.data ?? [];

        if (change.add) {
          const existing = currentMembers.find((cm) => cm.userId === managingMember.id);
          if (existing) {
            existing.role = change.role;
          } else {
            currentMembers.push({ userId: managingMember.id, role: change.role });
          }
        } else {
          currentMembers = currentMembers.filter((cm) => cm.userId !== managingMember.id);
        }

        const updateRes = await fetch(`/api/v1/organization/groups/${change.groupId}/members`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ members: currentMembers }),
        });
        const updateJson = await updateRes.json();
        if (!updateJson.success) throw new Error();
      }

      toast.success(t('group_membership_updated'));
      setManagingMember(null);
      load();
    } catch {
      toast.error(t('group_membership_failed'));
    }
  }

  async function handleRemove() {
    if (!removeId) return;
    try {
      const res = await fetch(`/api/v1/organization/members?userId=${removeId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error();
      setMembers(members.map((m) => (m.id === removeId ? { ...m, orgRoleName: 'member' } : m)));
      toast.success(t('member_removed'));
    } catch {
      toast.error(t('member_remove_failed'));
    }
    setRemoveId(null);
  }

  async function handleChangeRole() {
    if (!changingRole) return;
    try {
      const res = await fetch('/api/v1/organization/members', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId: changingRole.id, newRole: changingRole.role }),
      });
      if (!res.ok) throw new Error();
      setMembers(
        members.map((m) =>
          m.id === changingRole.id ? { ...m, orgRoleName: changingRole.role } : m,
        ),
      );
      toast.success(t('role_updated'));
    } catch {
      toast.error(t('role_update_failed'));
    }
    setChangingRole(null);
  }

  if (loading) return <div className="flex justify-center py-12">{t('common_loading')}</div>;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-bold">{t('title')}</h2>
        <span className="text-sm text-muted-foreground">
          {t('total_count', { count: members.length })}
        </span>
      </div>

      <div className="flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            placeholder={t('search_placeholder')}
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
        <Select value={filterRole} onValueChange={setFilterRole}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder={t('role_filter')} />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t('all_roles')}</SelectItem>
            {['teacher', 'member'].map((r) => (
              <SelectItem key={r} value={r}>
                {t(`role_${r}`)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('col_member')}</TableHead>
              <TableHead>{t('col_role')}</TableHead>
              <TableHead>{t('col_groups')}</TableHead>
              <TableHead>{t('col_joined')}</TableHead>
              <TableHead className="text-right">{t('col_actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((m) => (
              <TableRow key={m.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <UserAvatar name={m.full_name} email={m.email} size={32} />
                    <div>
                      <p className="font-medium">{m.full_name || t('unnamed')}</p>
                      <p className="text-xs text-muted-foreground">{m.email}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <span className="text-sm text-muted-foreground">{m.orgRoleName}</span>
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {m.groups.length > 0 ? (
                      m.groups.map((g) => (
                        <Badge key={g.id} variant="outline" className="text-xs">
                          {g.name}
                        </Badge>
                      ))
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </div>
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {new Date(m.created_at).toLocaleDateString()}
                </TableCell>
                <TableCell className="text-right">
                  {m.id === user?.id ? (
                    <span className="text-xs text-muted-foreground">{t('self_label')}</span>
                  ) : (
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={() => openManageDialog(m)}>
                        {t('manage_groups')}
                      </Button>
                      <Select
                        onValueChange={(v) => setChangingRole({ id: m.id, role: v })}
                        defaultValue={m.orgRoleName}
                      >
                        <SelectTrigger className="w-36 h-8">
                          <Shield className="mr-1 h-3 w-3" />
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {['teacher', 'member'].map((r) => (
                            <SelectItem key={r} value={r}>
                              {t(`role_${r}`)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button variant="ghost" size="icon" onClick={() => setRemoveId(m.id)}>
                        <UserMinus className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  )}
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center py-8 text-muted-foreground">
                  {t('no_members')}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>

      <AlertDialog open={!!removeId} onOpenChange={() => setRemoveId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('remove_dialog_title')}</AlertDialogTitle>
            <AlertDialogDescription>{t('remove_dialog_desc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common_cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleRemove}
              className="bg-destructive text-destructive-foreground"
            >
              {t('common_remove')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!changingRole} onOpenChange={() => setChangingRole(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('change_role_dialog_title')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('change_role_dialog_desc', { role: changingRole?.role.replace('_', ' ') ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common_cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleChangeRole}>{t('common_confirm')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!managingMember} onOpenChange={(o) => !o && setManagingMember(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t('manage_groups_title', {
                name: managingMember?.full_name || managingMember?.email || '',
              })}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            {orgGroups.map((group) => {
              const assignment = groupAssignments[group.id];
              const checked = assignment?.checked ?? false;
              return (
                <div key={group.id} className="flex items-center gap-3">
                  <Checkbox
                    checked={checked}
                    onCheckedChange={(c) =>
                      setGroupAssignments((prev) => ({
                        ...prev,
                        [group.id]: { ...prev[group.id], checked: !!c },
                      }))
                    }
                  />
                  <Label className="flex-1">{group.name}</Label>
                  {checked && (
                    <Select
                      value={assignment?.role ?? 'member'}
                      onValueChange={(v) =>
                        setGroupAssignments((prev) => ({
                          ...prev,
                          [group.id]: { ...prev[group.id], role: v },
                        }))
                      }
                    >
                      <SelectTrigger className="w-32 h-8">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="teacher">{t('role_teacher')}</SelectItem>
                        <SelectItem value="member">{t('role_member')}</SelectItem>
                      </SelectContent>
                    </Select>
                  )}
                </div>
              );
            })}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setManagingMember(null)}>
              {t('common_cancel')}
            </Button>
            <Button onClick={handleSaveGroupMemberships}>{t('common_save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
