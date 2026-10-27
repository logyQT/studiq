'use client';

import type { QuestionBank } from '@studiq/server/models/question-bank.model';
import { Button, Card, Skeleton } from '@studiq/ui';
import { useInfiniteQuery } from '@tanstack/react-query';
import { CheckSquare, Database, Plus, SearchX, SquarePen } from 'lucide-react';
import { useRouter } from 'next/navigation';
import type { useTranslations } from 'next-intl';
import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';
import { QuestionBankCard } from '@/components/questions/cards/question-bank-card';
import { QuestionBankFilters } from '@/components/questions/shared/question-bank-filters';
import { QuestionBankFormDialog } from '@/components/questions/shared/question-bank-form-dialog';
import { BulkActionBar } from '@/components/shared/bulk-action-bar';
import { DeleteConfirmDialog } from '@/components/shared/delete-confirm-dialog';
import { PageGrid } from '@/components/shared/page-grid';
import { SpeedDial } from '@/components/shared/speed-dial';
import { useApiMutation } from '@/hooks/use-api';
import { useGroupOptions } from '@/hooks/use-group-options';
import { useOrgs } from '@/hooks/use-orgs';
import { usePermission } from '@/hooks/use-permission';
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api';
import { resolveQuestionBankEmptyView } from '@/lib/question-bank-empty-state';
import { questionKeys } from '@/lib/query-keys';

interface QuestionBankManagementScreenProps {
  apiBase: string;
  basePath: string;
  t: ReturnType<typeof useTranslations>;
}

const STORAGE_KEY = 'question_banks_filters';

interface PersistedBankFilters {
  owner: string;
  groupIds: string[];
  sortBy: string;
  sortOrder: string;
  /** One-shot migration flag from the retired `groupFilter` blob (#595). */
  legacyMine: boolean;
}

function loadPersistedFilters(): PersistedBankFilters {
  const defaults: PersistedBankFilters = {
    owner: 'all',
    groupIds: [],
    sortBy: 'created_at',
    sortOrder: 'desc',
    legacyMine: false,
  };
  if (typeof window === 'undefined') return defaults;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      const groupIds = Array.isArray(parsed.groupIds)
        ? parsed.groupIds.filter((value): value is string => typeof value === 'string')
        : [];
      return {
        owner: parsed.owner === 'mine' ? 'mine' : 'all',
        groupIds,
        sortBy: typeof parsed.sortBy === 'string' ? parsed.sortBy : defaults.sortBy,
        sortOrder: typeof parsed.sortOrder === 'string' ? parsed.sortOrder : defaults.sortOrder,
        legacyMine: parsed.groupFilter === 'mine' && groupIds.length === 0,
      };
    }
  } catch {
    /* ignore */
  }
  return defaults;
}

export function QuestionBankManagementScreen({ basePath, t }: QuestionBankManagementScreenProps) {
  const _router = useRouter();
  const { activeOrg, isPending: orgsPending } = useOrgs();
  const permission = usePermission();
  const {
    groupsData,
    options: groupOptions,
    myGroupIds,
    groupNameMap,
    ready: groupsReady,
  } = useGroupOptions();
  const persisted = loadPersistedFilters();

  const [searchInput, setSearchInput] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [owner, setOwner] = useState(persisted.owner);
  const [groupIds, setGroupIds] = useState<string[]>(persisted.groupIds);
  const [sortBy, setSortBy] = useState(persisted.sortBy);
  const [sortOrder, setSortOrder] = useState(persisted.sortOrder);
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<QuestionBank | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const optionIds = new Set(groupOptions.map((group) => group.id));
  // Org switch / lost membership must never leave stale ids in the request.
  const effectiveGroupIds = groupIds.filter((id) => optionIds.has(id));
  const groupsParam = effectiveGroupIds.join(',') || undefined;

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchInput), 300);
    return () => clearTimeout(timer);
  }, [searchInput]);

  // One-shot migration from the retired `all|mine` group toggle (#595).
  const legacyMineRef = useRef(persisted.legacyMine);
  useEffect(() => {
    if (!groupsReady || !legacyMineRef.current) return;
    legacyMineRef.current = false;
    const migratedGroupIds = myGroupIds;
    setGroupIds(migratedGroupIds);
    persistFilters(owner, migratedGroupIds, sortBy, sortOrder);
  }, [groupsReady, myGroupIds, owner, sortBy, sortOrder]);

  const activeQuery = debouncedSearch.trim();

  const filters = {
    q: activeQuery || undefined,
    owner: owner !== 'all' ? owner : undefined,
    groups: groupsParam,
    sortBy,
    sortOrder,
  };

  const queryString = new URLSearchParams(
    Object.fromEntries(
      Object.entries(filters).filter((entry): entry is [string, string] => entry[1] !== undefined),
    ),
  ).toString();

  const {
    data: banksData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteQuery({
    queryKey: questionKeys.banks.paginated(filters, activeOrg?.id),
    queryFn: ({ pageParam }) =>
      apiGet<{ items: QuestionBank[]; nextCursor: string | null; hasMore: boolean }>(
        `/api/v1/questions/banks?limit=24${queryString ? `&${queryString}` : ''}${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: '',
    staleTime: Infinity,
    refetchOnMount: false,
    // Hold the first paint while a persisted selection waits for its options.
    enabled: !orgsPending && !(groupIds.length > 0 && !groupsReady),
  });

  const banks = banksData?.pages.flatMap((page) => page.items) ?? [];

  // #360 — an empty list caused by a filter must not claim the collection is empty.
  const emptyView = resolveQuestionBankEmptyView({
    query: activeQuery,
    owner,
    groupIds: effectiveGroupIds,
  });

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

  function persistFilters(o: string, gids: string[], sb: string, so: string) {
    try {
      localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({ owner: o, groupIds: gids, sortBy: sb, sortOrder: so }),
      );
    } catch {
      /* ignore */
    }
  }

  /**
   * #360 — resets exactly the state the request is built from, including the
   * debounced search (no 300 ms wait) and the persisted filters (so a reload does
   * not re-apply them). Sorting is not a filter and is kept.
   */
  function clearFilters() {
    setSearchInput('');
    setDebouncedSearch('');
    setOwner('all');
    setGroupIds([]);
    persistFilters('all', [], sortBy, sortOrder);
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

  return (
    <div className="space-y-6">
      <QuestionBankFilters
        searchInput={searchInput}
        onSearchChange={setSearchInput}
        owner={owner}
        onOwnerChange={(v) => {
          const nextOwner = v === 'mine' ? 'mine' : 'all';
          setOwner(nextOwner);
          persistFilters(nextOwner, groupIds, sortBy, sortOrder);
        }}
        groupIds={effectiveGroupIds}
        onGroupIdsChange={(next) => {
          setGroupIds(next);
          persistFilters(owner, next, sortBy, sortOrder);
        }}
        groupOptions={groupOptions}
        myGroupIds={myGroupIds}
        sortBy={sortBy}
        sortOrder={sortOrder}
        onSortChange={(sb, so) => {
          setSortBy(sb);
          setSortOrder(so);
          persistFilters(owner, groupIds, sb, so);
        }}
        onCreateNew={openCreate}
        t={t}
      />

      <PageGrid
        cols={4}
        isLoading={isLoading || orgsPending}
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
        emptyIcon={
          emptyView.kind === 'no-results' ? (
            <SearchX className="h-10 w-10 text-muted-foreground" />
          ) : (
            <Database className="h-10 w-10 text-muted-foreground" />
          )
        }
        emptyTitle={
          emptyView.kind === 'no-results'
            ? emptyView.query
              ? t('no_banks_match', { query: emptyView.query })
              : t('no_banks_match_filters')
            : t('no_banks')
        }
        emptyAction={
          emptyView.kind === 'no-results' ? (
            <Button variant="outline" size="sm" onClick={clearFilters}>
              {t('clear_filters')}
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={openCreate}>
              <Plus className="mr-1.5 h-4 w-4" /> {t('new_bank')}
            </Button>
          )
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
            canUpdate={permission('question_bank.update', {
              createdBy: bank.created_by,
              orgId: bank.organization_id ?? undefined,
            })}
            canDelete={permission('question_bank.delete', { createdBy: bank.created_by })}
            onEdit={() => openEdit(bank)}
            onDelete={() => setDeleteId(bank.id)}
            onSelect={() => setIsSelecting(true)}
            groupNames={
              bank.groupIds?.map((id) => groupNameMap.get(id)).filter(Boolean) as
                string[] | undefined
            }
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
