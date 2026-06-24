'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Plus, Trash2, Pencil, MoreVertical, Tags } from 'lucide-react';
import { Empty, EmptyMedia, EmptyTitle, EmptyDescription } from '@/components/ui/empty';
import { toast } from 'sonner';
import { Skeleton } from '@/components/ui/skeleton';
import { DeleteConfirmDialog } from '@/components/shared/delete-confirm-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { MarkdownRenderer } from '@/components/shared/markdown-renderer';
import { useApiQuery, useApiMutation } from '@/hooks/use-api';
import { apiPost, apiPut, apiDelete } from '@/lib/api';
import { flashcardKeys } from '@/lib/query-keys';
import type { Topic, Flashcard } from '@/types/flashcards';
import { getTopicColor } from '@/lib/color-utils';

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
  const { data: allFlashcardsData } = useApiQuery<{ items: Flashcard[]; nextCursor: string | null; hasMore: boolean }>({
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

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Topic | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [viewTopicId, setViewTopicId] = useState<string | null>(null);
  const [formData, setFormData] = useState({ name: '' });

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

  const viewFlashcards = viewTopicId
    ? flashcards.filter((fc) =>
        fc.flashcard_topic_assignments?.some((a) => a.topic_id === viewTopicId),
      )
    : [];

  const viewTopic = topics?.find((tp) => tp.id === viewTopicId);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-end">
        <Button onClick={openCreate}>
          <Plus className="mr-2 h-4 w-4" /> {t('new_topic')}
        </Button>
      </div>

      {isLoading ? (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Card key={i}>
              <CardContent className="p-5">
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
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {topics?.map((topic) => {
            const color = getTopicColor(topic.name);
            return (
              <Card key={topic.id} className="group cursor-pointer" onClick={() => setViewTopicId(topic.id)}>
                <CardContent className="p-5">
                  <div className="flex items-start justify-between">
                    <div
                      className={`h-10 w-10 rounded-lg ${color} flex items-center justify-center`}
                    >
                      <span className="text-sm font-bold text-white">
                        {topic.name.charAt(0).toUpperCase()}
                      </span>
                    </div>
                    <div className="md:hidden">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                          <Button variant="ghost" size="icon" className="h-7 w-7">
                            <MoreVertical className="h-3 w-3" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEdit(topic)}>
                            <Pencil className="mr-2 h-3 w-3" /> {t('common_edit')}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setDeleteId(topic.id)} className="text-destructive">
                            <Trash2 className="mr-2 h-3 w-3" /> {t('common_delete')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <div className="hidden md:block">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                            <MoreVertical className="h-3 w-3" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => openEdit(topic)}>
                            <Pencil className="mr-2 h-3 w-3" /> {t('common_edit')}
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => setDeleteId(topic.id)} className="text-destructive">
                            <Trash2 className="mr-2 h-3 w-3" /> {t('common_delete')}
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                  <h3 className="mt-3 font-semibold truncate">{topic.name}</h3>
                  <Badge variant="secondary" className="mt-2">
                    {t('flashcards_count', { count: topic.flashcard_count })}
                  </Badge>
                </CardContent>
              </Card>
            );
          })}
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

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editing ? t('edit_title') : t('new_topic_title')}</DialogTitle>
            <DialogDescription>{editing ? t('edit_desc') : t('new_topic_desc')}</DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="topic-name">{t('topic_name_label')}</Label>
            <Input
              id="topic-name"
              value={formData.name}
              onChange={(e) => setFormData({ name: e.target.value })}
              placeholder={t('topic_name_placeholder')}
              className="mt-2"
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setDialogOpen(false);
                resetForm();
              }}
            >
              {t('common_cancel')}
            </Button>
            <Button onClick={handleSubmit}>
              {editing ? t('common_update') : t('common_create')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={!!viewTopicId}
        onOpenChange={(open) => {
          if (!open) setViewTopicId(null);
        }}
      >
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {viewTopic && (
                <span className="flex items-center gap-2">
                  <div className={`h-5 w-5 rounded ${getTopicColor(viewTopic.name)}`} />
                  {viewTopic.name}
                </span>
              )}
            </DialogTitle>
            <DialogDescription>
              {t('view_flashcards_count', { count: viewFlashcards.length })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-4">
            {viewFlashcards.length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                {t('no_flashcards_for_topic')}
              </p>
            ) : (
              viewFlashcards.map((fc) => (
                <div key={fc.id} className="p-4 rounded-lg border space-y-2">
                  <div>
                    <p className="text-xs text-muted-foreground uppercase">{t('question_label')}</p>
                    <p className="text-sm font-medium"><MarkdownRenderer content={fc.front} /></p>
                  </div>
                  <div className="border-t pt-2">
                    <p className="text-xs text-muted-foreground uppercase">{t('answer_label')}</p>
                    <p className="text-sm"><MarkdownRenderer content={fc.back} /></p>
                  </div>
                </div>
              ))
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => setViewTopicId(null)}>{t('common_close')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeleteConfirmDialog
        open={!!deleteId}
        onOpenChange={() => setDeleteId(null)}
        onConfirm={handleDelete}
        title={t('delete_dialog_title')}
        description={t('delete_dialog_desc')}
        cancelText={t('common_cancel')}
        confirmText={t('common_delete')}
      />
    </div>
  );
}
