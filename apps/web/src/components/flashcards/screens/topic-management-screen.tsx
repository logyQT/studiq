'use client';

import type { Flashcard } from '@studiq/server/models/flashcard.model';
import type { Topic } from '@studiq/server/models/topic.model';
import { Button, Card, Skeleton } from '@studiq/ui';
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCheck, CheckSquare, Plus, SquarePen, Tags, Trash2 } from 'lucide-react';
import type { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { TopicCard } from '@/components/flashcards/cards/topic-card';
import { TopicFormDialog } from '@/components/flashcards/shared/topic-form-dialog';
import { TopicViewDialog } from '@/components/flashcards/shared/topic-view-dialog';
import { BulkActionBar } from '@/components/shared/bulk-action-bar';
import { DeleteConfirmDialog } from '@/components/shared/delete-confirm-dialog';
import { PageGrid } from '@/components/shared/page-grid';
import { PageToolbar } from '@/components/shared/page-toolbar';
import { ScopeGroupFilter } from '@/components/shared/scope-group-filter';
import { SortSelect } from '@/components/shared/sort-select';
import { SpeedDial } from '@/components/shared/speed-dial';
import { useApiMutation } from '@/hooks/use-api';
import { useDebounce } from '@/hooks/use-debounce';
import { useGroupOptions } from '@/hooks/use-group-options';
import { useInfiniteScroll } from '@/hooks/use-infinite-scroll';
import { useOrgs } from '@/hooks/use-orgs';
import { useSelection } from '@/hooks/use-selection';
import { apiDelete, apiGet, apiPost, apiPut } from '@/lib/api';
import { resolveListEmptyView } from '@/lib/list-empty-view';
import { flashcardKeys, topicKeys } from '@/lib/query-keys';

interface TopicManagementScreenProps {
  apiBase: string;
  t: ReturnType<typeof useTranslations>;
}

export function TopicManagementScreen({ t }: TopicManagementScreenProps) {
  const queryClient = useQueryClient();
  const { activeOrg, isPending: orgsPending } = useOrgs();
  const { groupsData, options: groupOptions, myGroupIds, ready: groupsReady } = useGroupOptions();

  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebounce(searchInput, 300);
  const [owner, setOwner] = useState('all');
  const [groupIds, setGroupIds] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState('desc');

  const optionIds = new Set(groupOptions.map((group) => group.id));
  // Org switch / lost membership must never leave stale ids in the request.
  const effectiveGroupIds = groupIds.filter((id) => optionIds.has(id));
  const groupsParam = effectiveGroupIds.join(',') || undefined;

  const filters = {
    q: debouncedSearch || undefined,
    owner: owner !== 'all' ? owner : undefined,
    groups: groupsParam,
    sortBy,
    sortOrder,
  };

  const queryString = Object.entries(filters)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v!)}`)
    .join('&');

  const {
    data: topicsData,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
    refetch,
  } = useInfiniteQuery({
    queryKey: topicKeys.paginated(filters, activeOrg?.id),
    queryFn: ({ pageParam }) =>
      apiGet<{ items: Topic[]; nextCursor: string | null; hasMore: boolean }>(
        `/api/v1/flashcards/topics?limit=50${queryString ? `&${queryString}` : ''}${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: '',
    staleTime: Infinity,
    refetchOnMount: false,
    // Hold the first paint while a selection waits for its options.
    enabled: !orgsPending && !(groupIds.length > 0 && !groupsReady),
  });

  const topics = topicsData?.pages.flatMap((page) => page.items) ?? [];

  const loadMoreRef = useInfiniteScroll({ hasNextPage, isFetchingNextPage, fetchNextPage });

  const createTopic = useApiMutation({
    mutationFn: (data: { name: string; visibility?: string; groupIds?: string[] }) =>
      apiPost<Topic>('/api/v1/flashcards/topics', data),
    invalidateKeys: [topicKeys.all],
  });
  const updateTopic = useApiMutation({
    mutationFn: ({
      id,
      ...data
    }: {
      id: string;
      name: string;
      visibility?: Topic['visibility'];
      groupIds?: string[];
    }) => apiPut<Topic>(`/api/v1/flashcards/topics/${id}`, data),
    invalidateKeys: [topicKeys.all],
    onMutate: async ({ id, ...data }) => {
      await queryClient.cancelQueries({ queryKey: topicKeys.all });
      const prev = queryClient.getQueryData<Topic[]>(topicKeys.all);
      queryClient.setQueryData<Topic[]>(topicKeys.all, (old) =>
        old?.map((topic) => (topic.id === id ? { ...topic, ...data } : topic)),
      );
      return { previous: prev };
    },
    onError: (_err, _vars, ctx) => {
      queryClient.setQueryData(topicKeys.all, ctx?.previous);
    },
  });
  const deleteTopic = useApiMutation({
    mutationFn: (id: string) => apiDelete(`/api/v1/flashcards/topics/${id}`),
    invalidateKeys: [topicKeys.all],
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: topicKeys.all });
      const prev = queryClient.getQueryData<Topic[]>(topicKeys.all);
      queryClient.setQueryData<Topic[]>(topicKeys.all, (old) =>
        old?.filter((topic) => topic.id !== id),
      );
      return { previous: prev };
    },
    onError: (_err, _id, ctx) => {
      queryClient.setQueryData(topicKeys.all, ctx?.previous);
    },
  });
  const batchDeleteTopics = useApiMutation({
    mutationFn: (data: { ids: string[] }) =>
      apiPost('/api/v1/flashcards/topics/batch/delete', data),
    invalidateKeys: [topicKeys.all],
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Topic | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [viewTopicId, setViewTopicId] = useState<string | null>(null);
  const [formData, setFormData] = useState<{
    name: string;
    visibility?: 'personal' | 'group';
    groupIds?: string[];
  }>({ name: '', visibility: 'personal', groupIds: [] });
  const selection = useSelection();

  const { data: topicFlashcardsData } = useInfiniteQuery({
    queryKey: [
      ...flashcardKeys.list({ topicIds: viewTopicId ? [viewTopicId] : [] }),
      'view',
      viewTopicId,
    ],
    queryFn: ({ pageParam }) =>
      apiGet<{ items: Flashcard[]; nextCursor: string | null; hasMore: boolean }>(
        `/api/v1/flashcards?topicIds=${viewTopicId}&limit=50${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: '',
    enabled: !!viewTopicId,
    staleTime: Infinity,
  });

  const viewFlashcards = topicFlashcardsData?.pages.flatMap((page) => page.items) ?? [];

  const viewTopic = topics.find((tp) => tp.id === viewTopicId);

  function resetForm() {
    setFormData({ name: '', visibility: 'personal', groupIds: [] });
    setEditing(null);
  }

  function openCreate() {
    resetForm();
    setDialogOpen(true);
  }

  function openEdit(topic: Topic) {
    setEditing(topic);
    setFormData({
      name: topic.name,
      visibility: topic.visibility ?? 'personal',
      groupIds: [],
    });
    setDialogOpen(true);
  }

  async function handleSubmit() {
    if (!formData.name.trim()) {
      toast.error(t('name_required'));
      return;
    }
    try {
      if (editing) {
        await updateTopic.mutateAsync({
          id: editing.id,
          name: formData.name,
          visibility: formData.visibility,
          groupIds: formData.visibility === 'group' ? formData.groupIds : undefined,
        });
      } else {
        await createTopic.mutateAsync({
          name: formData.name,
          visibility: formData.visibility,
          groupIds: formData.visibility === 'group' ? formData.groupIds : undefined,
        });
      }
      setDialogOpen(false);
      resetForm();
      toast.success(editing ? t('topic_updated') : t('topic_created'));
    } catch {
      toast.error(t('save_failed'));
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    try {
      await deleteTopic.mutateAsync(deleteId);
      toast.success(t('topic_deleted'));
    } catch {
      toast.error(t('delete_failed'));
    }
    setDeleteId(null);
  }

  function handleToggleSelect(id: string) {
    selection.toggleSelect(id);
  }

  function handleSelectAll() {
    selection.handleSelectAll(topics.map((topic) => topic.id));
  }

  function handleDeselectAll() {
    selection.handleDeselectAll();
  }

  function handleClearSelection() {
    selection.handleClearSelection();
  }

  async function handleBatchDeleteSelection() {
    const ids = Array.from(selection.selectedIds);
    if (ids.length === 0) return;
    try {
      await batchDeleteTopics.mutateAsync({ ids });
      toast.success(t('topic_deleted'));
      handleClearSelection();
    } catch {
      toast.error(t('delete_failed'));
    }
  }

  return (
    <div className="space-y-6">
      {selection.isSelecting && topics.length > 0 && (
        <div className="flex items-center gap-2 py-1">
          <Button
            variant="outline"
            size="sm"
            onClick={
              selection.selectedIds.size === topics.length ? handleDeselectAll : handleSelectAll
            }
          >
            <CheckCheck className="mr-1.5 h-4 w-4" />
            {selection.selectedIds.size === topics.length ? t('deselect_all') : t('select_all')}
          </Button>
          <span className="text-sm text-muted-foreground">
            {t('n_selected', { count: selection.selectedIds.size })}
          </span>
        </div>
      )}

      {!selection.isSelecting && (
        <PageToolbar
          search={{ value: searchInput, onChange: setSearchInput, placeholder: t('search_topics') }}
          actions={
            <Button onClick={openCreate}>
              <Plus className="mr-1.5 h-4 w-4" /> {t('new_topic')}
            </Button>
          }
        >
          <ScopeGroupFilter
            owner={owner}
            onOwnerChange={setOwner}
            groupIds={effectiveGroupIds}
            onGroupIdsChange={setGroupIds}
            options={groupOptions}
            myGroupIds={myGroupIds}
            t={t}
          />

          <SortSelect
            sortBy={sortBy}
            sortOrder={sortOrder}
            onChange={(sb, so) => {
              setSortBy(sb);
              setSortOrder(so);
            }}
            options={[
              { value: 'created_at:desc', label: t('sort_newest') },
              { value: 'created_at:asc', label: t('sort_oldest') },
              { value: 'name:asc', label: t('sort_name_asc') },
              { value: 'name:desc', label: t('sort_name_desc') },
            ]}
          />
        </PageToolbar>
      )}

      <PageGrid
        cols={4}
        isLoading={isLoading || orgsPending}
        skeleton={
          <Card className="flex flex-col h-full max-sm:py-0 min-w-0">
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
              <div className="flex-1" />
              <div className="flex items-center justify-between pt-4 mt-auto">
                <Skeleton className="h-6 w-16 rounded-full" />
                <Skeleton className="h-8 w-24 rounded-md" />
              </div>
            </div>
          </Card>
        }
        skeletonCount={8}
        hasNextPage={hasNextPage}
        isFetchingNextPage={isFetchingNextPage}
        loadMoreRef={loadMoreRef}
        isEmpty={topics.length === 0}
        isError={isError}
        onRetry={() => refetch()}
        emptyView={resolveListEmptyView({
          visibleCount: topics.length,
          query: debouncedSearch,
          activeFilters: (owner !== 'all' ? 1 : 0) + groupIds.length,
        })}
        onClearFilters={() => {
          setSearchInput('');
          setOwner('all');
          setGroupIds([]);
        }}
        emptyIcon={<Tags className="h-10 w-10 text-muted-foreground" />}
        emptyTitle={t('no_topics')}
        emptyAction={
          <Button variant="outline" size="sm" onClick={openCreate}>
            <Plus className="mr-1.5 h-4 w-4" /> {t('new_topic')}
          </Button>
        }
      >
        {topics.map((topic) => (
          <TopicCard
            key={topic.id}
            topic={topic}
            isSelected={selection.selectedIds.has(topic.id)}
            isSelecting={selection.isSelecting}
            onToggleSelect={() => handleToggleSelect(topic.id)}
            onView={() => setViewTopicId(topic.id)}
            onEdit={() => openEdit(topic)}
            onDelete={() => setDeleteId(topic.id)}
            t={t}
          />
        ))}
      </PageGrid>

      <TopicFormDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        editing={editing}
        formData={formData}
        onFormDataChange={setFormData}
        onSubmit={handleSubmit}
        onCancel={() => {
          setDialogOpen(false);
          resetForm();
        }}
        t={t}
        groups={groupsData}
      />

      <TopicViewDialog
        viewTopic={viewTopic}
        viewFlashcards={viewFlashcards}
        open={!!viewTopicId}
        onOpenChange={() => setViewTopicId(null)}
        t={t}
      />

      <DeleteConfirmDialog
        open={!!deleteId}
        onOpenChange={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title={t('delete_dialog_title')}
        description={t('delete_dialog_desc')}
        cancelText={t('common_cancel')}
        confirmText={t('common_delete')}
      />

      <BulkActionBar
        selectedCount={selection.selectedIds.size}
        onClearSelection={handleClearSelection}
      >
        <Button variant="destructive" size="sm" onClick={handleBatchDeleteSelection}>
          <Trash2 className="mr-1.5 h-4 w-4" /> {t('common_delete')}
        </Button>
      </BulkActionBar>

      {!selection.isSelecting && (
        <div className="sm:hidden">
          <SpeedDial
            items={[
              {
                icon: SquarePen,
                label: t('new_topic'),
                onClick: openCreate,
              },
              {
                icon: CheckSquare,
                label: t('select_topics'),
                onClick: () => selection.setIsSelecting(true),
              },
            ]}
          />
        </div>
      )}
    </div>
  );
}
