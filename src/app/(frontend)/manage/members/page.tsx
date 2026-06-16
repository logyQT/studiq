'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { RoleBadge } from '@/components/ui/role-badge';
import { DicebearAvatar } from '@/components/ui/dicebear-avatar';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { toast } from 'sonner';
import { Search, UserMinus, Shield } from 'lucide-react';
import { UserRole, UNIVERSITY_ROLES } from '@/types';
import { useTranslations } from 'next-intl';

interface Member {
  id: string;
  email: string;
  full_name: string | null;
  role: string;
  created_at: string;
}

export default function MembersPage() {
  const t = useTranslations('ManageMembersPage');
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterRole, setFilterRole] = useState('all');
  const [removeId, setRemoveId] = useState<string | null>(null);
  const [changingRole, setChangingRole] = useState<{ id: string; role: string } | null>(null);

  useEffect(() => {
    fetch('/api/v1/university/members')
      .then((r) => r.json())
      .then((data) => {
        setMembers(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  const filtered = members.filter((m) => {
    const matchesSearch =
      m.email.toLowerCase().includes(search.toLowerCase()) ||
      (m.full_name?.toLowerCase().includes(search.toLowerCase()) ?? false);
    const matchesRole = filterRole === 'all' || m.role === filterRole;
    return matchesSearch && matchesRole;
  });

  async function handleRemove() {
    if (!removeId) return;
    try {
      const res = await fetch(`/api/v1/university/members?userId=${removeId}`, {
        method: 'DELETE',
      });
      if (!res.ok) throw new Error();
      setMembers(members.map((m) => (m.id === removeId ? { ...m, role: UserRole.FREE } : m)));
      toast.success(t('member_removed'));
    } catch {
      toast.error(t('member_remove_failed'));
    }
    setRemoveId(null);
  }

  async function handleChangeRole() {
    if (!changingRole) return;
    try {
      const res = await fetch('/api/v1/university/members', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId: changingRole.id, newRole: changingRole.role }),
      });
      if (!res.ok) throw new Error();
      setMembers(
        members.map((m) => (m.id === changingRole.id ? { ...m, role: changingRole.role } : m)),
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
        <span className="text-sm text-muted-foreground">{t('total_count', { count: members.length })}</span>
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
            {UNIVERSITY_ROLES.map((r) => (
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
              <TableHead>{t('col_joined')}</TableHead>
              <TableHead className="text-right">{t('col_actions')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((m) => (
              <TableRow key={m.id}>
                <TableCell>
                  <div className="flex items-center gap-3">
                    <DicebearAvatar seed={m.email} size={32} />
                    <div>
                      <p className="font-medium">{m.full_name || t('unnamed')}</p>
                      <p className="text-xs text-muted-foreground">{m.email}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell>
                  <RoleBadge role={m.role as UserRole} />
                </TableCell>
                <TableCell className="text-sm text-muted-foreground">
                  {new Date(m.created_at).toLocaleDateString()}
                </TableCell>
                <TableCell className="text-right">
                  <div className="flex justify-end gap-2">
                    <Select
                      onValueChange={(v) => setChangingRole({ id: m.id, role: v })}
                      defaultValue={m.role}
                    >
                      <SelectTrigger className="w-36 h-8">
                        <Shield className="mr-1 h-3 w-3" />
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {UNIVERSITY_ROLES.map((r) => (
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
                </TableCell>
              </TableRow>
            ))}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center py-8 text-muted-foreground">
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
            <AlertDialogDescription>
              {t('remove_dialog_desc')}
            </AlertDialogDescription>
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
    </div>
  );
}
