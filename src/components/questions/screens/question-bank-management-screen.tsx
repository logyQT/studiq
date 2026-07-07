'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { CheckSquare, Database, Plus, SquarePen } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useAuth } from '@/components/providers/AuthProvider';
import { QuestionBankCard } from '@/components/questions/cards/question-bank-card';
import { QuestionBankFilters } from '@/components/questions/shared/question-bank-filters';
import { QuestionBankFormDialog } from '@/components/questions/shared/question-bank-form-dialog';
import { BulkActionBar } from '@/components/shared/bulk-action-bar';
import { DeleteConfirmDialog } from '@/components/shared/delete-confirm-dialog';
import { PageGrid } from '@/components/shared/page-grid';
import { SpeedDial } from '@/components/shared/speed-dial';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useApiMutation, useApiQuery } from '@/hooks/use-api';
import { useCan } from '@/hooks/use-can';
import { useOrgs } from '@/hooks/use-orgs';
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api';
import { groupKeys, questionKeys } from '@/lib/query-keys';
import type { QuestionBank } from '@/server/models';
import { AccountType } from '@/types';

interface QuestionBankManagementScreenProps {
  apiBase: string;
  basePath: string;
  t: ReturnType<typeof useTranslations>;
}

const STORAGE_KEY = 'question_banks_filters';

function loadPersistedFilters() {
  if (typeof window === 'undefined')
    return { owner: 'all', sortBy: 'created_at', sortOrder: 'desc' };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw);
  } catch {
    /* ignore */
  }
  return { owner: 'all', sortBy: 'created_at', sortOrder: 'desc' };
}

export function QuestionBankManagementScreen({ basePath, t }: QuestionBankManagementScreenProps) {
  const _router = useRouter();
  const { user } = useAuth();
  const { activeOrg } = useOrgs();
  const can = useCan();

  const { data: groupsData } = useApiQuery<Array<{ id: string; name: string }>>({
    queryKey: groupKeys.list(activeOrg?.id),
    url: '/api/v1/organization/groups',
    enabled: !!activeOrg?.id && can({ features: ['org.manage'] }),
  });
  const accountType = user?.app_metadata?.account_type as AccountType | undefined;

  const persisted = loadPersistedFilters();

  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [owner, setOwner] = useState(persisted.owner);
  const [sortBy, setSortBy] = useState(persisted.sortBy);
  const [sortOrder, setSortOrder] = useState(persisted.sortOrder);
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<QuestionBank | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  const filters = {
    q: debouncedSearch || undefined,
    owner: owner !== 'all' ? owner : undefined,
    sortBy,
    sortOrder,
  };

  const queryString = new URLSearchParams(
    Object.fromEntries(Object.entries(filters).filter(([, v]) => v !== undefined)),
  ).toString();

  const {
    data: banksData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteQuery({
    queryKey: questionKeys.banks.paginated(filters),
    queryFn: ({ pageParam }) =>
      apiGet<{ items: QuestionBank[]; nextCursor: string | null; hasMore: boolean }>(
        `/api/v1/questions/banks?limit=24${queryString ? `&${queryString}` : ''}${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: '',
    staleTime: Infinity,
    refetchOnMount: false,
  });

  const banks = banksData?.pages.flatMap((page) => page.items) ?? [];

  const loadMoreRef = useRef<HTMLDivElement>(null);
  const handleObserver = useCallback(
    (entries: IntersectionObserverEntry[]) => {
      const [entry] = entries;
      if (entry.isIntersecting && hasNextPage && !isFetchingNextPage) {
        fetchNextPage();
      }
    },
    [hasNextPage, isFetchingNextPage, fetchNextPage],
  );

  useEffect(() => {
    const el = loadMoreRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(handleObserver, { rootMargin: '200px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [handleObserver]);

  function persistFilters(o: string, sb: string, so: string) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ owner: o, sortBy: sb, sortOrder: so }));
    } catch {
      /* ignore */
    }
  }

  useEffect(() => {
    if (!isSelecting) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setSelectedIds(new Set());
        setIsSelecting(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isSelecting]);

  const createBank = useApiMutation({
    mutationFn: (data: {
      name: string;
      description?: string;
      visibility?: string;
      groupIds?: string[];
    }) => apiPost<QuestionBank>('/api/v1/questions/banks', data),
    invalidateKeys: [questionKeys.banks.all],
  });
  const updateBank = useApiMutation({
    mutationFn: ({
      id,
      ...data
    }: {
      id: string;
      name: string;
      description?: string;
      visibility?: string;
      groupIds?: string[];
    }) => apiPut<QuestionBank>(`/api/v1/questions/banks/${id}`, data),
    invalidateKeys: [questionKeys.banks.all],
  });
  const deleteBank = useApiMutation({
    mutationFn: (id: string) => apiDelete(`/api/v1/questions/banks/${id}`),
    invalidateKeys: [questionKeys.banks.all],
  });
  const batchDeleteBanks = useApiMutation({
    mutationFn: (data: { ids: string[] }) => apiPost('/api/v1/questions/banks/batch/delete', data),
    invalidateKeys: [questionKeys.banks.all],
  });

  function openCreate() {
    setEditing(null);
    setDialogOpen(true);
  }

  function openEdit(bank: QuestionBank) {
    setEditing(bank);
    setDialogOpen(true);
  }

  async function handleSubmit(data: {
    name: string;
    description: string;
    visibility?: 'personal' | 'group';
    groupIds?: string[];
  }) {
    if (!data.name.trim()) {
      toast.error(t('common_error'));
      return;
    }
    try {
      if (editing) {
        await updateBank.mutateAsync({
          id: editing.id,
          name: data.name,
          description: data.description || undefined,
          visibility: data.visibility,
          groupIds: data.visibility === 'group' ? data.groupIds : undefined,
        });
        toast.success(t('bank_updated'));
      } else {
        await createBank.mutateAsync({
          name: data.name,
          description: data.description || undefined,
          visibility: data.visibility,
          groupIds: data.visibility === 'group' ? data.groupIds : undefined,
        });
        toast.success(t('bank_created'));
      }
      setDialogOpen(false);
      setEditing(null);
    } catch {
      toast.error(t('common_error'));
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    try {
      await deleteBank.mutateAsync(deleteId);
      toast.success(t('bank_deleted'));
    } catch {
      toast.error(t('common_error'));
    }
    setDeleteId(null);
  }

  function handleToggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleClearSelection() {
    setSelectedIds(new Set());
    setIsSelecting(false);
  }

  async function handleBatchDeleteSelection() {
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    try {
      await batchDeleteBanks.mutateAsync({ ids });
      toast.success(t('bank_deleted'));
      handleClearSelection();
    } catch {
      toast.error(t('common_error'));
    }
  }

  const canSeeGroup =
    activeOrg?.orgRoleName === 'teacher' ||
    activeOrg?.orgRoleName === 'admin' ||
    accountType === AccountType.MANAGER;

  return (
    <div className="space-y-6">
      <QuestionBankFilters
        canSeeGroup={canSeeGroup}
        searchInput={searchInput}
        onSearchChange={setSearchInput}
        owner={owner}
        onOwnerChange={(v) => {
          setOwner(v);
          persistFilters(v, sortBy, sortOrder);
        }}
        sortBy={sortBy}
        sortOrder={sortOrder}
        onSortChange={(sb, so) => {
          setSortBy(sb);
          setSortOrder(so);
          persistFilters(owner, sb, so);
        }}
        onCreateNew={openCreate}
        t={t}
      />

      <PageGrid
        cols={4}
        isLoading={isLoading}
        skeleton={
          <Card className="flex flex-col h-full max-sm:py-0 min-w-0 p-0">
            <div className="flex items-center gap-3 p-4 sm:hidden">
              <Skeleton className="h-10 w-10 rounded-xl shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-1/2" />
                <Skeleton className="h-3 w-1/4" />
              </div>
              <Skeleton className="h-7 w-7 rounded-md shrink-0" />
            </div>
            <div className="hidden sm:flex flex-col h-full p-5 space-y-4">
              <div className="flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-xl" />
                <Skeleton className="h-6 w-3/4" />
              </div>
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-4/5" />
              </div>
              <div className="flex items-center justify-between pt-4 mt-auto">
                <Skeleton className="h-6 w-16 rounded-full" />
                <Skeleton className="h-8 w-24 rounded-md" />
              </div>
            </div>
          </Card>
        }
        skeletonCount={12}
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        loadMoreRef={loadMoreRef}
        isEmpty={banks.length === 0}
        emptyIcon={<Database className="h-10 w-10 text-muted-foreground" />}
        emptyTitle={t('no_banks')}
        emptyAction={
          <Button variant="outline" size="sm" onClick={openCreate}>
            <Plus className="mr-1.5 h-4 w-4" /> {t('new_bank')}
          </Button>
        }
      >
        {banks.map((bank) => (
          <QuestionBankCard
            key={bank.id}
            bank={bank}
            isSelecting={isSelecting}
            isSelected={selectedIds.has(bank.id)}
            onToggleSelect={() => handleToggleSelect(bank.id)}
            basePath={basePath}
            t={t}
            canUpdate={can({ permissions: ['question_bank.update'], createdBy: bank.created_by })}
            canDelete={can({ permissions: ['question_bank.delete'], createdBy: bank.created_by })}
            onEdit={() => openEdit(bank)}
            onDelete={() => setDeleteId(bank.id)}
            onSelect={() => setIsSelecting(true)}
          />
        ))}
      </PageGrid>

      <QuestionBankFormDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setTimeout(() => setEditing(null), 200);
        }}
        initialValues={
          editing ? { name: editing.name, description: editing.description ?? '' } : null
        }
        onSubmit={handleSubmit}
        title={editing ? t('edit_bank') : t('new_bank')}
        description={editing ? t('common_edit') : t('common_create')}
        nameLabel={t('name_label')}
        namePlaceholder={t('name_placeholder')}
        descriptionLabel={t('description_label')}
        descriptionPlaceholder={t('description_placeholder')}
        cancelLabel={t('common_cancel')}
        submitLabel={editing ? t('common_update') : t('common_create')}
        groups={groupsData}
        visibilityLabel={t('visibility_label')}
        visibilityPersonalLabel={t('visibility_personal')}
        visibilityGroupLabel={t('visibility_group')}
        groupsPlaceholder={t('groups_placeholder')}
        groupsEmptyText={t('groups_empty')}
      />

      <DeleteConfirmDialog
        open={!!deleteId}
        onOpenChange={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title={t('delete_title')}
        description={t('delete_desc')}
        cancelText={t('common_cancel')}
        confirmText={t('common_delete')}
      />

      <BulkActionBar selectedCount={selectedIds.size} onClearSelection={handleClearSelection}>
        <Button variant="destructive" size="sm" onClick={handleBatchDeleteSelection}>
          <Plus className="mr-1.5 h-4 w-4" /> {t('common_delete')}
        </Button>
      </BulkActionBar>

      {!isSelecting && (
        <div className="sm:hidden">
          <SpeedDial
            items={[
              { icon: SquarePen, label: t('new_bank'), onClick: openCreate },
              {
                icon: CheckSquare,
                label: t('common_manage'),
                onClick: () => setIsSelecting(true),
              },
            ]}
          />
        </div>
      )}
    </div>
  );
}
