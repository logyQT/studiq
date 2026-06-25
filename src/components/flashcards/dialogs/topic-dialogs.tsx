'use client';

import { useState, useCallback } from 'react';
import { useTranslations } from 'next-intl';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { MultiSelect } from '@/components/ui/multi-select';
import { MarkdownRenderer } from '@/components/shared/markdown-renderer';
import { Plus } from 'lucide-react';
import { getTopicColor } from '@/lib/color-utils';
import { apiPost, apiPut } from '@/lib/api';
import { useQueryClient } from '@tanstack/react-query';
import { flashcardKeys } from '@/lib/query-keys';
import type { Topic, Flashcard } from '@/types/flashcards';

interface TopicDialogsProps {
  t: ReturnType<typeof useTranslations>;
  topics: Topic[];
  flashcards: Flashcard[];
  activeFlashcardId: string | null;
  viewTopicId: string | null;
  onViewTopicIdChange: (id: string | null) => void;
  addTopicOpen: boolean;
  onAddTopicOpenChange: (open: boolean) => void;
  manageTopicOpen: boolean;
  onManageTopicOpenChange: (open: boolean) => void;
  onTopicActionIdsChange: (ids: string[]) => void;
  onAddTopicConfirm: () => void;
}

export function TopicDialogs({
  t,
  topics,
  flashcards,
  activeFlashcardId,
  viewTopicId,
  onViewTopicIdChange,
  addTopicOpen,
  onAddTopicOpenChange,
  manageTopicOpen,
  onManageTopicOpenChange,
  onTopicActionIdsChange: _onTopicActionIdsChange,
  onAddTopicConfirm: _onAddTopicConfirm,
}: TopicDialogsProps) {
  const queryClient = useQueryClient();
  const [newTopicName, setNewTopicName] = useState('');
  const [creatingTopic, setCreatingTopic] = useState(false);
  const [topicActionIds, setTopicActionIds] = useState<string[]>([]);

  function getTopicIds(fc: Flashcard | undefined) {
    return fc?.flashcard_topic_assignments?.map((a) => a.topic_id) ?? [];
  }

  const handleCreateAndLinkTopic = useCallback(async () => {
    const name = newTopicName.trim();
    if (!name || !activeFlashcardId) return;
    const fc = flashcards.find((f) => f.id === activeFlashcardId);
    if (!fc) return;

    setCreatingTopic(true);
    try {
      const newTopic = await apiPost<{ id: string; name: string }>('/api/v1/flashcards/topics', {
        name,
      });
      const currentIds = getTopicIds(fc);
      const newIds = [...new Set([...currentIds, newTopic.id])];
      await apiPut<Flashcard>(`/api/v1/flashcards/${fc.id}`, {
        front: fc.front,
        back: fc.back,
        topicIds: newIds,
      });
      queryClient.invalidateQueries({ queryKey: flashcardKeys.topics.all });
      queryClient.invalidateQueries({ queryKey: flashcardKeys.decks.all });
      setNewTopicName('');
      onAddTopicOpenChange(false);
    } catch {
      // error handled by parent
    } finally {
      setCreatingTopic(false);
    }
  }, [newTopicName, activeFlashcardId, flashcards, queryClient, onAddTopicOpenChange]);

  const handleManageTopicsConfirm = useCallback(async () => {
    if (!activeFlashcardId) return;
    const fc = flashcards.find((f) => f.id === activeFlashcardId);
    if (!fc) return;
    try {
      await apiPut<Flashcard>(`/api/v1/flashcards/${fc.id}`, {
        front: fc.front,
        back: fc.back,
        topicIds: topicActionIds,
      });
      queryClient.invalidateQueries({ queryKey: flashcardKeys.decks.all });
      onManageTopicOpenChange(false);
    } catch {
      // error handled by parent
    }
  }, [activeFlashcardId, topicActionIds, flashcards, queryClient, onManageTopicOpenChange]);

  return (
    <>
      <Dialog
        open={!!viewTopicId}
        onOpenChange={(open) => {
          if (!open) onViewTopicIdChange(null);
        }}
      >
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {(() => {
                const viewTopic = topics.find((tp) => tp.id === viewTopicId);
                return viewTopic ? (
                  <span className="flex items-center gap-2">
                    <div className={`h-5 w-5 rounded ${getTopicColor(viewTopic.name)}`} />
                    {viewTopic.name}
                  </span>
                ) : null;
              })()}
            </DialogTitle>
            <DialogDescription>
              {t('view_flashcards_for_topic', {
                count: (flashcards ?? []).filter((fc) =>
                  fc.flashcard_topic_assignments?.some((a) => a.topic_id === viewTopicId),
                ).length,
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-4">
            {(flashcards ?? []).filter((fc) =>
              fc.flashcard_topic_assignments?.some((a) => a.topic_id === viewTopicId),
            ).length === 0 ? (
              <p className="text-center text-muted-foreground py-8">
                {t('no_flashcards_for_topic')}
              </p>
            ) : (
              (flashcards ?? [])
                .filter((fc) =>
                  fc.flashcard_topic_assignments?.some((a) => a.topic_id === viewTopicId),
                )
                .map((fc) => (
                  <div key={fc.id} className="p-4 rounded-lg border space-y-2">
                    <div>
                      <p className="text-xs text-muted-foreground uppercase">
                        {t('question_label')}
                      </p>
                      <p className="text-sm font-medium">
                        <MarkdownRenderer content={fc.front} />
                      </p>
                    </div>
                    <div className="border-t pt-2">
                      <p className="text-xs text-muted-foreground uppercase">{t('answer_label')}</p>
                      <p className="text-sm">
                        <MarkdownRenderer content={fc.back} />
                      </p>
                    </div>
                  </div>
                ))
            )}
          </div>
          <DialogFooter>
            <Button onClick={() => onViewTopicIdChange(null)}>{t('common_close')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={addTopicOpen}
        onOpenChange={(open) => {
          if (!open) {
            setNewTopicName('');
            onAddTopicOpenChange(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('add_topic_title')}</DialogTitle>
            <DialogDescription>{t('add_topic_desc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <Input
              value={newTopicName}
              onChange={(e) => setNewTopicName(e.target.value)}
              placeholder={t('add_topic_input_placeholder')}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newTopicName.trim()) {
                  e.preventDefault();
                  handleCreateAndLinkTopic();
                }
              }}
            />
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {(() => {
                const fc = flashcards.find((f) => f.id === activeFlashcardId);
                const assignedIds = getTopicIds(fc);
                const filtered = topics.filter(
                  (topic) =>
                    !assignedIds.includes(topic.id) &&
                    topic.name.toLowerCase().includes(newTopicName.toLowerCase()),
                );
                const exactMatch = topics.find(
                  (topic) => topic.name.toLowerCase() === newTopicName.trim().toLowerCase(),
                );
                return (
                  <>
                    {newTopicName.trim() && !exactMatch && (
                      <button
                        onClick={handleCreateAndLinkTopic}
                        disabled={creatingTopic}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent transition-colors"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        <span className="text-muted-foreground">
                          {t('add_topic_create_new', { name: newTopicName.trim() })}
                        </span>
                      </button>
                    )}
                    {filtered.map((topic) => (
                      <button
                        key={topic.id}
                        onClick={async () => {
                          const currentIds = getTopicIds(
                            flashcards.find((f) => f.id === activeFlashcardId),
                          );
                          const newIds = [...new Set([...currentIds, topic.id])];
                          const fc = flashcards.find((f) => f.id === activeFlashcardId);
                          if (!fc) return;
                          try {
                            await apiPut(`/api/v1/flashcards/${fc.id}`, {
                              front: fc.front,
                              back: fc.back,
                              topicIds: newIds,
                            });
                            queryClient.invalidateQueries({ queryKey: flashcardKeys.decks.all });
                            onAddTopicOpenChange(false);
                          } catch {
                            // error handled by parent
                          }
                        }}
                        className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-accent transition-colors"
                      >
                        <div
                          className={`h-2 w-2 rounded-full shrink-0 ${getTopicColor(topic.name)}`}
                        />
                        {topic.name}
                      </button>
                    ))}
                    {newTopicName.trim() && filtered.length === 0 && !exactMatch && (
                      <p className="text-xs text-muted-foreground text-center py-2">
                        {t('add_topic_no_matches')}
                      </p>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setNewTopicName('');
                onAddTopicOpenChange(false);
              }}
            >
              {t('common_cancel')}
            </Button>
            <Button
              onClick={handleCreateAndLinkTopic}
              disabled={!newTopicName.trim() || creatingTopic}
            >
              {creatingTopic ? t('common_adding') : t('common_add')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={manageTopicOpen}
        onOpenChange={(open) => {
          if (!open) {
            setTopicActionIds([]);
            onManageTopicOpenChange(false);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('manage_topic_title')}</DialogTitle>
            <DialogDescription>{t('manage_topic_desc')}</DialogDescription>
          </DialogHeader>
          <div className="py-2">
            {(() => {
              const fc = flashcards.find((f) => f.id === activeFlashcardId);
              const currentIds = getTopicIds(fc);
              const topicOptions = topics.map((topic) => ({ label: topic.name, value: topic.id }));
              return (
                <MultiSelect
                  options={topicOptions}
                  selected={topicActionIds.length > 0 ? topicActionIds : currentIds}
                  onChange={(ids) => setTopicActionIds(ids)}
                  placeholder={t('manage_topic_select')}
                />
              );
            })()}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => onManageTopicOpenChange(false)}>
              {t('common_cancel')}
            </Button>
            <Button onClick={handleManageTopicsConfirm}>{t('common_save')}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
