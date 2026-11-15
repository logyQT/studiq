'use client';

import type { Flashcard } from '@studiq/server/models/flashcard.model';
import type { Topic } from '@studiq/server/models/topic.model';
import { Button } from '@studiq/ui';
import { useInfiniteQuery } from '@tanstack/react-query';
import { CheckCheck, CheckSquare, Plus, SquarePen, Tags } from 'lucide-react';
import type { useTranslations } from 'next-intl';
import { useState } from 'react';
import { toast } from 'sonner';
import { TopicCard } from '@/components/flashcards/cards/topic-card';
import { TopicFormDialog } from '@/components/flashcards/shared/topic-form-dialog';
import { TopicViewDialog } from '@/components/flashcards/shared/topic-view-dialog';
import { CollectionScreen, useCollectionScreen } from '@/components/shared/collection-screen';
import { CollectionCardSkeleton } from '@/components/shared/page-grid';
import { apiGet } from '@/lib/api';
import { flashcardKeys, topicKeys } from '@/lib/query-keys';

interface TopicManagementScreenProps {
  t: ReturnType<typeof useTranslations>;
}

interface TopicFormData {
  name: string;
  visibility?: 'personal' | 'group';
  groupIds?: string[];
}

const EMPTY_FORM: TopicFormData = { name: '', visibility: 'personal', groupIds: [] };

export function TopicManagementScreen({ t }: TopicManagementScreenProps) {
  const [viewTopicId, setViewTopicId] = useState<string | null>(null);
  const [formData, setFormData] = useState<TopicFormData>(EMPTY_FORM);

  const screen = useCollectionScreen<Topic>({
    url: '/api/v1/topics',
    persistKey: 'topics_filters',
    queryKey: (filters, orgId) => topicKeys.paginated(filters, orgId),
    invalidateKeys: [topicKeys.all],
    limit: 50,
  });
  const { create, update, selection, items } = screen;

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
  const viewTopic = items.find((topic) => topic.id === viewTopicId);

  function resetForm() {
    setFormData(EMPTY_FORM);
    screen.closeDialog();
  }

  function openEdit(topic: Topic) {
    setFormData({
      name: topic.name,
      visibility: topic.visibility ?? 'personal',
      groupIds: [],
    });
    screen.openEdit(topic);
  }

  async function handleSubmit() {
    if (!formData.name.trim()) {
      toast.error(t('name_required'));
      return;
    }
    const body = {
      name: formData.name,
      visibility: formData.visibility,
      groupIds: formData.visibility === 'group' ? formData.groupIds : undefined,
    };
    try {
      if (screen.editing) await update.mutateAsync({ id: screen.editing.id, ...body });
      else await create.mutateAsync(body);
      resetForm();
      toast.success(screen.editing ? t('topic_updated') : t('topic_created'));
    } catch {
      toast.error(t('save_failed'));
    }
  }

  return (
    <CollectionScreen<Topic>
      t={t}
      screen={screen}
      top={
        selection.isSelecting &&
        items.length > 0 && (
          <div className="flex items-center gap-2 py-1">
            <Button
              variant="outline"
              size="sm"
              onClick={
                selection.selectedIds.size === items.length
                  ? selection.handleDeselectAll
                  : () => selection.handleSelectAll(items.map((topic) => topic.id))
              }
            >
              <CheckCheck className="mr-1.5 h-4 w-4" />
              {selection.selectedIds.size === items.length ? t('deselect_all') : t('select_all')}
            </Button>
            <span className="text-sm text-muted-foreground">
              {t('n_selected', { count: selection.selectedIds.size })}
            </span>
          </div>
        )
      }
      actions={
        <Button className="justify-start" onClick={screen.openCreate}>
          <Plus className="h-4 w-4" /> {t('new_topic')}
        </Button>
      }
      searchPlaceholder={t('search_topics')}
      skeleton={<CollectionCardSkeleton description={false} />}
      skeletonCount={8}
      emptyIcon={<Tags className="h-10 w-10 text-muted-foreground" />}
      emptyTitle={t('no_topics')}
      emptyAction={
        <Button variant="outline" size="sm" onClick={screen.openCreate}>
          <Plus className="mr-1.5 h-4 w-4" /> {t('new_topic')}
        </Button>
      }
      onClearFilters={screen.clearFilters}
      deleteLabels={{ title: t('delete_dialog_title'), description: t('delete_dialog_desc') }}
      deletedMessage={t('topic_deleted')}
      speedDialItems={[
        { icon: SquarePen, label: t('new_topic'), onClick: screen.openCreate },
        {
          icon: CheckSquare,
          label: t('select_topics'),
          onClick: () => selection.setIsSelecting(true),
        },
      ]}
      renderCard={(topic) => (
        <TopicCard
          topic={topic}
          isSelected={selection.selectedIds.has(topic.id)}
          isSelecting={selection.isSelecting}
          onToggleSelect={() => selection.toggleSelect(topic.id)}
          onView={() => setViewTopicId(topic.id)}
          onEdit={() => openEdit(topic)}
          onDelete={() => screen.setDeleteId(topic.id)}
          t={t}
        />
      )}
    >
      <TopicFormDialog
        open={screen.dialogOpen}
        onOpenChange={(open) => {
          if (open) screen.setDialogOpen(true);
          else resetForm();
        }}
        editing={screen.editing}
        formData={formData}
        onFormDataChange={setFormData}
        onSubmit={handleSubmit}
        onCancel={resetForm}
        t={t}
        groups={screen.groupsData}
      />

      <TopicViewDialog
        viewTopic={viewTopic}
        viewFlashcards={viewFlashcards}
        open={!!viewTopicId}
        onOpenChange={() => setViewTopicId(null)}
        t={t}
      />
    </CollectionScreen>
  );
}
