'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CheckCheck, Tags, CheckSquare, SquarePen, Plus, Search, X, Lock } from 'lucide-react';
import { Empty, EmptyMedia, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { DeleteConfirmDialog } from '@/components/shared/delete-confirm-dialog';
import { useApiMutation } from '@/hooks/use-api';
import { apiGet, apiPost, apiPut, apiDelete } from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';
import { flashcardKeys } from '@/lib/query-keys';
import type { Topic, Flashcard } from '@/types/flashcards';
import { SpeedDial } from '@/components/shared/speed-dial';
import { TopicBulkActions } from '@/components/flashcards/shared/topic-bulk-actions';
import { TopicCard } from '@/components/flashcards/cards/topic-card';
import { TopicFormDialog } from '@/components/flashcards/shared/topic-form-dialog';
import { TopicViewDialog } from '@/components/flashcards/shared/topic-view-dialog';
import { useSelection } from '@/hooks/use-selection';
import { useDebounce } from '@/hooks/use-debounce';
import { useFeature } from '@/hooks/use-feature';

interface TopicManagementScreenProps {
  apiBase: string;
  t: ReturnType<typeof useTranslations>;
}

export function TopicManagementScreen({ t }: TopicManagementScreenProps) {
  const router = useRouter();
  const queryClient = useQueryClient();

  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebounce(searchInput, 300);
  const [owner, setOwner] = useState('all');
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState('desc');

  const filters = {
    q: debouncedSearch || undefined,
    owner: owner !== 'all' ? owner : undefined,
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
  } = useInfiniteQuery({
    queryKey: flashcardKeys.topics.paginated(filters),
    queryFn: ({ pageParam }) =>
      apiGet<{ items: Topic[]; nextCursor: string | null; hasMore: boolean }>(
        `/api/v1/flashcards/topics?limit=50${queryString ? `&${queryString}` : ''}${pageParam ? `&cursor=${pageParam}` : ''}`,
      ),
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    initialPageParam: '',
    staleTime: Infinity,
    refetchOnMount: false,
  });

  const topics = topicsData?.pages.flatMap((page) => page.items) ?? [];

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

  const createTopic = useApiMutation({
    mutationFn: (data: { name: string }) => apiPost<Topic>('/api/v1/flashcards/topics', data),
    invalidateKeys: [flashcardKeys.topics.all],
  });
  const updateTopic = useApiMutation({
    mutationFn: ({ id, ...data }: { id: string; name: string }) =>
      apiPut<Topic>(`/api/v1/flashcards/topics/${id}`, data),
    invalidateKeys: [flashcardKeys.topics.all],
    onMutate: async ({ id, ...data }) => {
      await queryClient.cancelQueries({ queryKey: flashcardKeys.topics.all });
      const prev = queryClient.getQueryData<Topic[]>(flashcardKeys.topics.all);
      queryClient.setQueryData<Topic[]>(flashcardKeys.topics.all, (old) =>
        old?.map((t) => (t.id === id ? { ...t, ...data } : t)),
      );
      return { previous: prev };
    },
    onError: (_err, _vars, ctx) => {
      queryClient.setQueryData(flashcardKeys.topics.all, ctx?.previous);
    },
  });
  const deleteTopic = useApiMutation({
    mutationFn: (id: string) => apiDelete(`/api/v1/flashcards/topics/${id}`),
    invalidateKeys: [flashcardKeys.topics.all],
    onMutate: async (id) => {
      await queryClient.cancelQueries({ queryKey: flashcardKeys.topics.all });
      const prev = queryClient.getQueryData<Topic[]>(flashcardKeys.topics.all);
      queryClient.setQueryData<Topic[]>(flashcardKeys.topics.all, (old) =>
        old?.filter((t) => t.id !== id),
      );
      return { previous: prev };
    },
    onError: (_err, _id, ctx) => {
      queryClient.setQueryData(flashcardKeys.topics.all, ctx?.previous);
    },
  });
  const batchDeleteTopics = useApiMutation({
    mutationFn: (data: { ids: string[] }) =>
      apiPost('/api/v1/flashcards/topics/batch/delete', data),
    invalidateKeys: [flashcardKeys.topics.all],
  });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Topic | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [viewTopicId, setViewTopicId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: '' });
  const selection = useSelection();
  const canCreateTopic = useFeature('study.create');
  const { isSelecting: selectionIsActive, handleClearSelection: selectionClear } = selection;

  const { data: topicFlashcardsData } = useInfiniteQuery({
    queryKey: [...flashcardKeys.list({ topicIds: viewTopicId ? [viewTopicId] : [] }), 'view', viewTopicId],
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

  const viewTopic = topics?.find((tp) => tp.id === viewTopicId);

  useEffect(() => {
    if (!selectionIsActive) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        selectionClear();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectionIsActive, selectionClear]);

  function resetForm() {
    setFormData({ name: '' });
    setEditing(null);
  }

  function openCreate() {
    resetForm();
    setDialogOpen(true);
  }

  function openEdit(topic: Topic) {
    setEditing(topic);
    setFormData({ name: topic.name });
    setDialogOpen(true);
  }

  async function handleSubmit() {
    if (!formData.name.trim()) {
      toast.error(t('name_required'));
      return;
    }
    try {
      if (editing) {
        await updateTopic.mutateAsync({ id: editing.id, name: formData.name });
      } else {
        await createTopic.mutateAsync({ name: formData.name });
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
    if (!topics) return;
    selection.handleSelectAll(topics.map((t) => t.id));
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
      {selection.isSelecting && topics && topics.length > 0 && (
        <div className="flex items-center gap-2 py-1">
          <Button
            variant="outline"
            size="sm"
            onClick={selection.selectedIds.size === topics.length ? handleDeselectAll : handleSelectAll}
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
        <div className="flex flex-wrap items-center gap-3 max-sm:hidden">
          <div className="relative flex-1 basis-full lg:basis-auto lg:max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={t('search_topics')}
              className="pl-9 pr-9"
            />
            {searchInput && (
              <button
                onClick={() => setSearchInput('')}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <Select value={owner} onValueChange={setOwner}>
            <SelectTrigger className="w-35 truncate">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t('owner_all')}</SelectItem>
              <SelectItem value="mine">{t('owner_mine')}</SelectItem>
              <SelectItem value="shared">{t('owner_shared')}</SelectItem>
            </SelectContent>
          </Select>

          <Select value={`${sortBy}:${sortOrder}`} onValueChange={(v) => {
            const [sb, so] = v.split(':');
            setSortBy(sb);
            setSortOrder(so);
          }}>
            <SelectTrigger className="w-37.5 truncate">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="created_at:desc">{t('sort_newest')}</SelectItem>
              <SelectItem value="created_at:asc">{t('sort_oldest')}</SelectItem>
              <SelectItem value="name:asc">{t('sort_name_asc')}</SelectItem>
              <SelectItem value="name:desc">{t('sort_name_desc')}</SelectItem>
            </SelectContent>
          </Select>

          <div className="sm:ml-auto">
            <Button disabled={!canCreateTopic.hasAccess} onClick={canCreateTopic.hasAccess ? openCreate : () => router.push('/checkout?plan_id=student_premium')}>
              {canCreateTopic.hasAccess ? (
                <><Plus className="mr-1.5 h-4 w-4" /> {t('new_topic')}</>
              ) : (
                <><Lock className="size-3" /> Upgrade</>
              )}
            </Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i} className="flex flex-col h-full max-sm:py-0 min-w-0">
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
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
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
          {hasNextPage && Array.from({ length: 8 }).map((_, i) => (
            <Card key={`skel-${i}`} className="flex flex-col h-full max-sm:py-0 min-w-0 p-0">
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
            ))}
          <div ref={loadMoreRef} className="min-h-[1px]" />
          {topics.length === 0 && !isFetchingNextPage && (
            <Empty className="col-span-full">
              <EmptyMedia>
                <Tags className="h-10 w-10 text-muted-foreground" />
              </EmptyMedia>
              <EmptyTitle>{t('no_topics')}</EmptyTitle>
              <EmptyDescription>
                <Button variant="outline" size="sm" disabled={!canCreateTopic.hasAccess} onClick={canCreateTopic.hasAccess ? openCreate : () => router.push('/checkout?plan_id=student_premium')}>
                  {canCreateTopic.hasAccess ? (
                    <><Plus className="mr-1.5 h-4 w-4" /> {t('new_topic')}</>
                  ) : (
                    <><Lock className="size-3" /> Upgrade</>
                  )}
                </Button>
              </EmptyDescription>
            </Empty>
          )}
        </div>
      )}

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

      <TopicBulkActions
        selectedCount={selection.selectedIds.size}
        onDelete={handleBatchDeleteSelection}
        onClearSelection={handleClearSelection}
        t={t}
      />

      {!selection.isSelecting && (
        <div className="sm:hidden">
          <SpeedDial
            items={[
              { icon: SquarePen, label: t('new_topic'), onClick: canCreateTopic.hasAccess ? openCreate : () => router.push('/checkout?plan_id=student_premium') },
              { icon: CheckSquare, label: t('select_topics'), onClick: () => selection.setIsSelecting(true) },
            ]}
          />
        </div>
      )}
    </div>
  );
}
