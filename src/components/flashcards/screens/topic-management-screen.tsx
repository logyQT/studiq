'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
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
import { CheckCheck, Tags, CheckSquare, SquarePen, Plus, Search, X } from 'lucide-react';
import { Empty, EmptyMedia, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { DeleteConfirmDialog } from '@/components/shared/delete-confirm-dialog';
import { useApiQuery, useApiMutation } from '@/hooks/use-api';
import { apiPost, apiPut, apiDelete } from '@/lib/api';
import { useAuth } from '@/components/providers/AuthProvider';
import { flashcardKeys } from '@/lib/query-keys';
import type { Topic, Flashcard } from '@/types/flashcards';
import { SpeedDial } from '@/components/shared/speed-dial';
import { TopicBulkActions } from '@/components/flashcards/shared/topic-bulk-actions';
import { TopicCard } from '@/components/flashcards/cards/topic-card';
import { TopicFormDialog } from '@/components/flashcards/shared/topic-form-dialog';
import { TopicViewDialog } from '@/components/flashcards/shared/topic-view-dialog';
import { useSelection } from '@/hooks/use-selection';
import { useDebounce } from '@/hooks/use-debounce';

interface TopicManagementScreenProps {
  apiBase: string;
  t: ReturnType<typeof useTranslations>;
}

export function TopicManagementScreen({ t }: TopicManagementScreenProps) {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { data: topics, isLoading } = useApiQuery<Topic[]>({
    queryKey: flashcardKeys.topics.all,
    url: '/api/v1/flashcards/topics',
  });
  const { data: allFlashcardsData } = useApiQuery<{
    items: Flashcard[];
    nextCursor: string | null;
    hasMore: boolean;
  }>({
    queryKey: flashcardKeys.list({}),
    url: '/api/v1/flashcards',
  });
  const flashcards = allFlashcardsData?.items ?? [];
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

  const [searchInput, setSearchInput] = useState('');
  const debouncedSearch = useDebounce(searchInput, 300);
  const [owner, setOwner] = useState('all');
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState('desc');
  const filteredTopics = topics
    ?.filter((t) => {
      if (owner === 'mine' && t.created_by !== user?.id) return false;
      if (owner === 'shared' && t.created_by === user?.id) return false;
      return t.name.toLowerCase().includes(debouncedSearch.toLowerCase());
    })
    .sort((a, b) => {
      const dir = sortOrder === 'desc' ? -1 : 1;
      if (sortBy === 'name') return dir * a.name.localeCompare(b.name);
      const dateA = a.created_at ? new Date(a.created_at).getTime() : 0;
      const dateB = b.created_at ? new Date(b.created_at).getTime() : 0;
      return dir * (dateA - dateB);
    });

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Topic | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [viewTopicId, setViewTopicId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: '' });
  const selection = useSelection();
  const { isSelecting: selectionIsActive, handleClearSelection: selectionClear } = selection;

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
    if (!filteredTopics) return;
    selection.handleSelectAll(filteredTopics.map((t) => t.id));
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

  const viewFlashcards = viewTopicId
    ? flashcards.filter((fc) =>
        fc.flashcard_topic_assignments?.some((a) => a.topic_id === viewTopicId),
      )
    : [];

  const viewTopic = topics?.find((tp) => tp.id === viewTopicId);

  return (
    <div className="space-y-6">
      {selection.isSelecting && filteredTopics && filteredTopics.length > 0 && (
        <div className="flex items-center gap-2 py-1">
          <Button
            variant="outline"
            size="sm"
            onClick={selection.selectedIds.size === filteredTopics.length ? handleDeselectAll : handleSelectAll}
          >
            <CheckCheck className="mr-1.5 h-4 w-4" />
            {selection.selectedIds.size === filteredTopics.length ? t('deselect_all') : t('select_all')}
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
            <Button onClick={openCreate}>
              <Plus className="mr-1.5 h-4 w-4" /> {t('new_topic')}
            </Button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i} className="flex flex-col h-full max-sm:py-0 min-w-0">
              {/* Mobile Skeleton */}
              <div className="flex items-center gap-3 p-4 sm:hidden">
                <Skeleton className="h-10 w-10 rounded-xl shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-3 w-1/4" />
                </div>
                <Skeleton className="h-7 w-7 rounded-md shrink-0" />
              </div>
              {/* Desktop Skeleton */}
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
          {filteredTopics?.map((topic) => (
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
          {(!filteredTopics || filteredTopics.length === 0) && (
            <Empty className="col-span-full">
              <EmptyMedia>
                <Tags className="h-10 w-10 text-muted-foreground" />
              </EmptyMedia>
              <EmptyTitle>{t('no_topics')}</EmptyTitle>
              <EmptyDescription>
                <Button variant="outline" size="sm" onClick={openCreate}>
                  <Plus className="mr-1.5 h-4 w-4" /> {t('new_topic')}
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
              { icon: SquarePen, label: t('new_topic'), onClick: openCreate },
              { icon: CheckSquare, label: t('select_topics'), onClick: () => selection.setIsSelecting(true) },
            ]}
          />
        </div>
      )}
    </div>
  );
}
