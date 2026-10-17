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
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
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
  Tabs,
  TabsList,
  TabsTrigger,
} from '@studiq/ui';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Plus,
  RotateCcw,
  ShieldX,
  Trash2,
} from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';
import { ConfirmDialog } from '@/app/(frontend)/components/confirm-dialog';
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api';
import { queryKeys } from '@/lib/query-keys';

const ACCOUNT_TYPES = ['student', 'educator', 'manager'] as const;
const PER_PAGE = 20;

type AdminUser = {
  id: string;
  email: string;
  fullName: string | null;
  createdAt: string;
  personalPlanKey: string | null;
  accountType: string | null;
  bannedUntil: string | null;
  deletedAt: string | null;
  purgeAt: string | null;
};

type ListResponse = {
  users: AdminUser[];
  total: number;
  page: number;
  perPage: number;
};

type CreateForm = {
  email: string;
  password: string;
  fullName: string;
  accountType: (typeof ACCOUNT_TYPES)[number];
};

const EMPTY_CREATE_FORM: CreateForm = {
  email: '',
  password: '',
  fullName: '',
  accountType: 'student',
};

function daysUntil(iso: string): number {
  return Math.max(0, Math.ceil((new Date(iso).getTime() - Date.now()) / (24 * 60 * 60 * 1000)));
}

export default function UsersPage() {
  const t = useTranslations('Users');
  const tc = useTranslations('Common');
  const queryClient = useQueryClient();

  const [status, setStatus] = useState<'active' | 'deleted'>('active');
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');

  const { data, isLoading, isFetching } = useQuery({
    queryKey: queryKeys.users.list(status, page, search),
    queryFn: () => {
      const params = new URLSearchParams({ status, page: String(page), perPage: String(PER_PAGE) });
      if (search) params.set('search', search);
      return apiGet<ListResponse>(`/users?${params.toString()}`);
    },
  });

  const users = data?.users ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PER_PAGE));

  const [createOpen, setCreateOpen] = useState(false);
  const [createForm, setCreateForm] = useState<CreateForm>(EMPTY_CREATE_FORM);
  const [createError, setCreateError] = useState<string | null>(null);

  const [roleTarget, setRoleTarget] = useState<AdminUser | null>(null);
  const [roleValue, setRoleValue] = useState<(typeof ACCOUNT_TYPES)[number]>('student');

  const [deleteTarget, setDeleteTarget] = useState<AdminUser | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<AdminUser | null>(null);
  const [purgeTarget, setPurgeTarget] = useState<AdminUser | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  function invalidate() {
    queryClient.invalidateQueries({ queryKey: ['users'] });
  }

  const createMutation = useMutation({
    mutationFn: (form: CreateForm) =>
      apiPost('/users', {
        email: form.email,
        password: form.password,
        fullName: form.fullName || undefined,
        accountType: form.accountType,
      }),
    onSuccess: () => {
      invalidate();
      setCreateOpen(false);
      setCreateForm(EMPTY_CREATE_FORM);
      setCreateError(null);
    },
    onError: (error: Error) => setCreateError(error.message),
  });

  const roleMutation = useMutation({
    mutationFn: ({ id, accountType }: { id: string; accountType: string }) =>
      apiPut(`/users/${id}`, { accountType }),
    onSuccess: () => {
      invalidate();
      setRoleTarget(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiDelete(`/users/${id}`),
    onSuccess: () => {
      invalidate();
      setDeleteTarget(null);
    },
  });

  const restoreMutation = useMutation({
    mutationFn: (id: string) => apiPost(`/users/${id}/restore`, {}),
    onSuccess: () => {
      invalidate();
      setRestoreTarget(null);
    },
  });

  const purgeMutation = useMutation({
    mutationFn: (id: string) => apiPost(`/users/${id}/purge`, {}),
    onSuccess: () => {
      invalidate();
      setPurgeTarget(null);
    },
  });

  function openRoleDialog(user: AdminUser) {
    setRoleTarget(user);
    setRoleValue((user.accountType as (typeof ACCOUNT_TYPES)[number]) ?? 'student');
  }

  function openCreate() {
    setCreateForm(EMPTY_CREATE_FORM);
    setCreateError(null);
    setCreateOpen(true);
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

      <Tabs
        value={status}
        onValueChange={(v) => {
          setStatus(v as 'active' | 'deleted');
          setPage(1);
        }}
      >
        <TabsList>
          <TabsTrigger value="active">{t('tab_active')}</TabsTrigger>
          <TabsTrigger value="deleted">{t('tab_deleted')}</TabsTrigger>
        </TabsList>
      </Tabs>

      <Card>
        <CardHeader>
          <CardTitle>
            {status === 'active' ? t('list_title_active') : t('list_title_deleted')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <Input
            placeholder={t('search_placeholder')}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="max-w-sm"
          />

          {isLoading ? (
            <p className="text-muted-foreground">{tc('loading')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-8" />
                  <TableHead>{t('col_email')}</TableHead>
                  <TableHead>{t('col_name')}</TableHead>
                  <TableHead>{t('col_account_type')}</TableHead>
                  <TableHead>{t('col_plan')}</TableHead>
                  <TableHead>
                    {status === 'active' ? t('col_created') : t('col_purge_in')}
                  </TableHead>
                  <TableHead className="w-24" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => (
                  <>
                    <TableRow key={u.id}>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-6 w-6"
                          onClick={() => setExpandedId(expandedId === u.id ? null : u.id)}
                        >
                          {expandedId === u.id ? (
                            <ChevronDown className="h-4 w-4" />
                          ) : (
                            <ChevronRight className="h-4 w-4" />
                          )}
                        </Button>
                      </TableCell>
                      <TableCell className="text-sm">{u.email}</TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {u.fullName ?? '—'}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">
                          {u.accountType ? t(`account_type_${u.accountType}`) : '—'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {u.personalPlanKey ?? '—'}
                      </TableCell>
                      <TableCell className="text-sm">
                        {status === 'active'
                          ? new Date(u.createdAt).toLocaleDateString()
                          : u.purgeAt
                            ? t('days_remaining', { count: daysUntil(u.purgeAt) })
                            : '—'}
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {status === 'active' ? (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                title={t('change_role')}
                                onClick={() => openRoleDialog(u)}
                              >
                                <ShieldX className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                title={t('delete')}
                                onClick={() => setDeleteTarget(u)}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </>
                          ) : (
                            <>
                              <Button
                                variant="ghost"
                                size="icon"
                                title={t('restore')}
                                onClick={() => setRestoreTarget(u)}
                              >
                                <RotateCcw className="h-4 w-4" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="icon"
                                title={t('purge_now')}
                                onClick={() => setPurgeTarget(u)}
                              >
                                <Trash2 className="h-4 w-4 text-destructive" />
                              </Button>
                            </>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                    {expandedId === u.id && (
                      <TableRow key={`${u.id}-detail`}>
                        <TableCell colSpan={7} className="bg-muted/30 px-12 py-3">
                          <UserOrgs userId={u.id} />
                        </TableCell>
                      </TableRow>
                    )}
                  </>
                ))}
                {users.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                      {status === 'active' ? t('empty_active') : t('empty_deleted')}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          )}

          <div className="flex items-center justify-between pt-2">
            <p className="text-sm text-muted-foreground">
              {t('page_of_total', { page, totalPages, total })}
              {isFetching && ` · ${tc('loading')}`}
            </p>
            <div className="flex gap-1">
              <Button
                variant="outline"
                size="icon"
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>
              <Button
                variant="outline"
                size="icon"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Create user dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('create')}</DialogTitle>
          </DialogHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              createMutation.mutate(createForm);
            }}
            className="space-y-4"
          >
            {createError && (
              <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {createError}
              </p>
            )}
            <div className="space-y-2">
              <Label>{t('col_email')}</Label>
              <Input
                type="email"
                value={createForm.email}
                onChange={(e) => setCreateForm({ ...createForm, email: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>{t('password')}</Label>
              <Input
                type="password"
                minLength={8}
                value={createForm.password}
                onChange={(e) => setCreateForm({ ...createForm, password: e.target.value })}
                required
              />
            </div>
            <div className="space-y-2">
              <Label>{t('col_name')}</Label>
              <Input
                value={createForm.fullName}
                onChange={(e) => setCreateForm({ ...createForm, fullName: e.target.value })}
              />
            </div>
            <div className="space-y-2">
              <Label>{t('col_account_type')}</Label>
              <Select
                value={createForm.accountType}
                onValueChange={(v) =>
                  setCreateForm({ ...createForm, accountType: v as CreateForm['accountType'] })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ACCOUNT_TYPES.map((type) => (
                    <SelectItem key={type} value={type}>
                      {t(`account_type_${type}`)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>
                {tc('cancel')}
              </Button>
              <Button type="submit" disabled={createMutation.isPending}>
                {tc('save')}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Change role dialog */}
      <Dialog open={!!roleTarget} onOpenChange={(open) => !open && setRoleTarget(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('change_role')}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <p className="text-sm text-muted-foreground">{roleTarget?.email}</p>
            <Select value={roleValue} onValueChange={(v) => setRoleValue(v as typeof roleValue)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ACCOUNT_TYPES.map((type) => (
                  <SelectItem key={type} value={type}>
                    {t(`account_type_${type}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRoleTarget(null)}>
                {tc('cancel')}
              </Button>
              <Button
                disabled={roleMutation.isPending}
                onClick={() =>
                  roleTarget && roleMutation.mutate({ id: roleTarget.id, accountType: roleValue })
                }
              >
                {tc('save')}
              </Button>
            </DialogFooter>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title={t('delete_title')}
        description={t('delete_desc', { email: deleteTarget?.email ?? '' })}
        onConfirm={() => deleteTarget && deleteMutation.mutate(deleteTarget.id)}
        confirmLabel={tc('delete')}
        destructive
      />

      <ConfirmDialog
        open={!!restoreTarget}
        onOpenChange={(open) => !open && setRestoreTarget(null)}
        title={t('restore_title')}
        description={t('restore_desc', { email: restoreTarget?.email ?? '' })}
        onConfirm={() => restoreTarget && restoreMutation.mutate(restoreTarget.id)}
        confirmLabel={t('restore')}
      />

      <ConfirmDialog
        open={!!purgeTarget}
        onOpenChange={(open) => !open && setPurgeTarget(null)}
        title={t('purge_title')}
        description={t('purge_desc', { email: purgeTarget?.email ?? '' })}
        onConfirm={() => purgeTarget && purgeMutation.mutate(purgeTarget.id)}
        confirmLabel={t('purge_now')}
        destructive
      />
    </div>
  );
}

type UserDetail = {
  memberships: Array<{
    organization_id: string;
    organizations: { name: string };
    org_roles: { name: string };
  }>;
};

function UserOrgs({ userId }: { userId: string }) {
  const t = useTranslations('Users');

  const { data, isLoading } = useQuery({
    queryKey: queryKeys.users.detail(userId),
    queryFn: () => apiGet<UserDetail>(`/users/${userId}`),
  });

  const memberships = data?.memberships ?? [];

  if (isLoading) return <p className="text-sm text-muted-foreground">…</p>;
  if (memberships.length === 0) {
    return <p className="text-sm text-muted-foreground">{t('no_orgs')}</p>;
  }

  return (
    <div className="flex flex-wrap gap-1">
      {memberships.map((m) => (
        <span
          key={m.organization_id}
          className="inline-flex items-center rounded-md bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary"
        >
          {m.organizations.name} · {m.org_roles.name}
        </span>
      ))}
    </div>
  );
}
