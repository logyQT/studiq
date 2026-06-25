'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { CheckCheck, Tags, CheckSquare, SquarePen, Plus } from 'lucide-react';
import { Empty, EmptyMedia, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { DeleteConfirmDialog } from '@/components/shared/delete-confirm-dialog';
import { useApiQuery, useApiMutation } from '@/hooks/use-api';
import { apiPost, apiPut, apiDelete } from '@/lib/api';
import { flashcardKeys } from '@/lib/query-keys';
import type { Topic, Flashcard } from '@/types/flashcards';
import { SpeedDial } from '@/components/shared/speed-dial';
import { TopicBulkActions } from '@/components/flashcards/shared/topic-bulk-actions';
import { TopicCard } from '@/components/flashcards/cards/topic-card';
import { TopicFormDialog } from '@/components/flashcards/shared/topic-form-dialog';
import { TopicViewDialog } from '@/components/flashcards/shared/topic-view-dialog';
import { useSelection } from '@/hooks/use-selection';

interface TopicManagementScreenProps {
  apiBase: string;
  t: ReturnType<typeof useTranslations>;
}

export function TopicManagementScreen({ t }: TopicManagementScreenProps) {
  const queryClient = useQueryClient();
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

  const viewFlashcards = viewTopicId
    ? flashcards.filter((fc) =>
        fc.flashcard_topic_assignments?.some((a) => a.topic_id === viewTopicId),
      )
    : [];

  const viewTopic = topics?.find((tp) => tp.id === viewTopicId);

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

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i}>
              <div className="p-5">
                <div className="flex items-start justify-between">
                  <Skeleton className="h-10 w-10 rounded-lg" />
                  <div className="flex gap-1">
                    <Skeleton className="h-7 w-7" />
                  </div>
                </div>
                <div className="mt-3 space-y-2">
                  <Skeleton className="h-5 w-3/4" />
                  <Skeleton className="h-5 w-20" />
                  <Skeleton className="h-9 w-full" />
                </div>
              </div>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {topics?.map((topic) => (
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
          {(!topics || topics.length === 0) && (
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
        <SpeedDial
          items={[
            { icon: SquarePen, label: t('new_topic'), onClick: openCreate },
            { icon: CheckSquare, label: t('select_topics'), onClick: () => selection.setIsSelecting(true) },
          ]}
        />
      )}
    </div>
  );
}
